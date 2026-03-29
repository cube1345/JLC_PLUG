const PCB_LAYER_TOP = 1;
const PCB_LAYER_BOTTOM = 2;
const PCB_LAYER_TOP_SILK = 3;
const PCB_LAYER_BOTTOM_SILK = 4;

type Point = {
	x: number;
	y: number;
};

type Vector = Point;

type HeaderPad = {
	padNumber: string;
	netName: string;
	silkLabel: string;
	x: number;
	y: number;
	padShape: unknown;
	majorProjection: number;
	minorProjection: number;
	rowIndex: number;
};

type HeaderRow = {
	index: number;
	meanMinor: number;
	pads: Array<HeaderPad>;
};

type HeaderAxis = {
	center: Point;
	major: Vector;
	minor: Vector;
};

type HeaderComponent = {
	component: any;
	componentId: string;
	designator: string;
	padCount: number;
	recognizedNetCount: number;
	componentLayer: number;
	textLayer: number;
	mirror: boolean;
	textRotation: number;
	labelOffset: number;
	fontSize: number;
	lineWidth: number;
	nominalPitch: number;
	axis: HeaderAxis;
	rows: Array<HeaderRow>;
	pads: Array<HeaderPad>;
};

type HeaderLabelPlacement = {
	text: string;
	x: number;
	y: number;
	rotation: number;
};

type SilkImagePlacement = HeaderLabelPlacement & {
	topLeftX: number;
	topLeftY: number;
	imageWidth: number;
	imageHeight: number;
	complexPolygon: any;
};

const TEXT_RENDER_FONT_PX = 64;
const TEXT_RENDER_PADDING_X_PX = 10;
const TEXT_RENDER_PADDING_Y_PX = 8;

function asArray<T>(value: T | Array<T> | undefined | null): Array<T> {
	if (Array.isArray(value)) {
		return value;
	}
	return value == null ? [] : [value];
}

function normalizeText(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function getHeaderPadPreview(header: HeaderComponent, maxItems = 6): string {
	return header.pads
		.slice(0, maxItems)
		.map(pad => `${pad.padNumber}:${pad.netName || pad.silkLabel}`)
		.join('，');
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function makeSilkLabel(netName: string, padNumber: string): string {
	const normalizedNet = normalizeText(netName);
	if (!normalizedNet) {
		return `P${padNumber || '?'}`;
	}

	const slashSegments = normalizedNet.split('/').filter(Boolean);
	const tail = slashSegments.at(-1) || normalizedNet;
	const dotSegments = tail.split('.').filter(Boolean);
	const compact = normalizeText(dotSegments.at(-1) || tail);
	return compact || normalizedNet;
}

function getComponentDisplayName(component: any): string {
	const designator = normalizeText(String(component.getState_Designator?.() || ''));
	if (designator) {
		return designator;
	}

	const name = normalizeText(String(component.getState_Name?.() || ''));
	if (name) {
		return name;
	}

	const componentId = normalizeText(String(component.getState_PrimitiveId?.() || ''));
	return componentId || 'HEADER';
}

function dot(a: Vector, b: Vector): number {
	return a.x * b.x + a.y * b.y;
}

function normalizeVector(vector: Vector): Vector {
	const length = Math.hypot(vector.x, vector.y);
	if (length <= 1e-9) {
		return { x: 1, y: 0 };
	}
	return {
		x: vector.x / length,
		y: vector.y / length,
	};
}

function getAxis(points: Array<Point>): HeaderAxis {
	const center = points.reduce((acc, point) => ({
		x: acc.x + point.x,
		y: acc.y + point.y,
	}), { x: 0, y: 0 });

	center.x /= points.length || 1;
	center.y /= points.length || 1;

	let sxx = 0;
	let syy = 0;
	let sxy = 0;

	for (const point of points) {
		const dx = point.x - center.x;
		const dy = point.y - center.y;
		sxx += dx * dx;
		syy += dy * dy;
		sxy += dx * dy;
	}

	const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
	let major = normalizeVector({ x: Math.cos(angle), y: Math.sin(angle) });

	if (Math.abs(major.x) >= Math.abs(major.y)) {
		if (major.x < 0) {
			major = { x: -major.x, y: -major.y };
		}
	}
	else if (major.y < 0) {
		major = { x: -major.x, y: -major.y };
	}

	let minor = normalizeVector({ x: -major.y, y: major.x });
	if (Math.abs(minor.y) >= Math.abs(minor.x)) {
		if (minor.y < 0) {
			minor = { x: -minor.x, y: -minor.y };
		}
	}
	else if (minor.x < 0) {
		minor = { x: -minor.x, y: -minor.y };
	}

	return { center, major, minor };
}

function getSortedUnique(values: Array<number>, tolerance: number): Array<number> {
	const sorted = [...values].sort((a, b) => a - b);
	const unique: Array<number> = [];

	for (const value of sorted) {
		if (unique.length === 0 || Math.abs(value - unique.at(-1)!) > tolerance) {
			unique.push(value);
		}
	}

	return unique;
}

function median(values: Array<number>): number {
	if (values.length === 0) {
		return 0;
	}

	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return (sorted[middle - 1] + sorted[middle]) / 2;
	}
	return sorted[middle];
}

function getPadExtent(padShape: unknown): number {
	if (!Array.isArray(padShape)) {
		return 0;
	}

	const numericValues = padShape.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
	if (numericValues.length === 0) {
		return 0;
	}

	return Math.max(...numericValues);
}

function estimatePitch(projections: Array<number>): number {
	const unique = getSortedUnique(projections, 1e-6);
	if (unique.length < 2) {
		return 0;
	}

	const diffs: Array<number> = [];
	for (let index = 1; index < unique.length; index += 1) {
		const diff = unique[index] - unique[index - 1];
		if (diff > 1e-6) {
			diffs.push(diff);
		}
	}

	return median(diffs);
}

function clusterRows(pads: Array<HeaderPad>, tolerance: number): Array<HeaderRow> {
	const sortedPads = [...pads].sort((a, b) => a.minorProjection - b.minorProjection);
	const rows: Array<HeaderRow> = [];

	for (const pad of sortedPads) {
		const currentRow = rows.at(-1);
		if (!currentRow) {
			rows.push({ index: 0, meanMinor: pad.minorProjection, pads: [pad] });
			continue;
		}

		if (Math.abs(pad.minorProjection - currentRow.meanMinor) <= tolerance) {
			currentRow.pads.push(pad);
			currentRow.meanMinor = currentRow.pads.reduce((sum, item) => sum + item.minorProjection, 0) / currentRow.pads.length;
		}
		else {
			rows.push({ index: rows.length, meanMinor: pad.minorProjection, pads: [pad] });
		}
	}

	for (const row of rows) {
		row.pads.sort((a, b) => a.majorProjection - b.majorProjection);
		for (const pad of row.pads) {
			pad.rowIndex = row.index;
		}
	}

	return rows;
}

function getTextRotation(axis: HeaderAxis): number {
	return Math.abs(axis.major.x) >= Math.abs(axis.major.y) ? 0 : 90;
}

function dataUrlToBlob(dataUrl: string): Blob {
	const base64Data = dataUrl.split(',')[1] || '';
	const byteCharacters = atob(base64Data);
	const byteArray = new Uint8Array(byteCharacters.length);
	for (let index = 0; index < byteCharacters.length; index += 1) {
		byteArray[index] = byteCharacters.charCodeAt(index);
	}
	return new Blob([byteArray], { type: 'image/png' });
}

async function renderTextToBlob(text: string): Promise<{
	blob: Blob;
	widthPx: number;
	heightPx: number;
}> {
	const fontDeclaration = `600 ${TEXT_RENDER_FONT_PX}px sans-serif`;

	if (typeof document !== 'undefined') {
		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('无法创建文字图像绘制上下文。');
		}

		context.font = fontDeclaration;
		const measuredWidth = Math.max(Math.ceil(context.measureText(text).width), TEXT_RENDER_FONT_PX);
		const widthPx = measuredWidth + TEXT_RENDER_PADDING_X_PX * 2;
		const heightPx = Math.ceil(TEXT_RENDER_FONT_PX * 1.25) + TEXT_RENDER_PADDING_Y_PX * 2;

		canvas.width = widthPx;
		canvas.height = heightPx;

		const drawContext = canvas.getContext('2d');
		if (!drawContext) {
			throw new Error('无法创建文字图像绘制上下文。');
		}

		drawContext.clearRect(0, 0, widthPx, heightPx);
		drawContext.fillStyle = '#000000';
		drawContext.textBaseline = 'top';
		drawContext.font = fontDeclaration;
		drawContext.fillText(text, TEXT_RENDER_PADDING_X_PX, TEXT_RENDER_PADDING_Y_PX);

		return {
			blob: dataUrlToBlob(canvas.toDataURL('image/png')),
			widthPx,
			heightPx,
		};
	}

	if (typeof OffscreenCanvas !== 'undefined') {
		const canvas = new OffscreenCanvas(1, 1);
		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('无法创建离屏绘制上下文。');
		}

		context.font = fontDeclaration;
		const measuredWidth = Math.max(Math.ceil(context.measureText(text).width), TEXT_RENDER_FONT_PX);
		const widthPx = measuredWidth + TEXT_RENDER_PADDING_X_PX * 2;
		const heightPx = Math.ceil(TEXT_RENDER_FONT_PX * 1.25) + TEXT_RENDER_PADDING_Y_PX * 2;

		canvas.width = widthPx;
		canvas.height = heightPx;

		const drawContext = canvas.getContext('2d');
		if (!drawContext) {
			throw new Error('无法创建离屏绘制上下文。');
		}

		drawContext.clearRect(0, 0, widthPx, heightPx);
		drawContext.fillStyle = '#000000';
		drawContext.textBaseline = 'top';
		drawContext.font = fontDeclaration;
		drawContext.fillText(text, TEXT_RENDER_PADDING_X_PX, TEXT_RENDER_PADDING_Y_PX);

		return {
			blob: await canvas.convertToBlob({ type: 'image/png' }),
			widthPx,
			heightPx,
		};
	}

	throw new Error('当前运行环境不支持文字图像生成。');
}

function getImageTopLeftFromCenter(centerX: number, centerY: number, width: number, height: number, rotation: number): Point {
	const normalizedRotation = ((Math.round(rotation) % 360) + 360) % 360;

	switch (normalizedRotation) {
		case 0:
			return { x: centerX - width / 2, y: centerY + height / 2 };
		case 90:
			return { x: centerX - height / 2, y: centerY - width / 2 };
		case 180:
			return { x: centerX + width / 2, y: centerY - height / 2 };
		case 270:
			return { x: centerX + height / 2, y: centerY + width / 2 };
		default:
			return { x: centerX - width / 2, y: centerY + height / 2 };
	}
}

async function getSelectedComponents(): Promise<Array<any>> {
	if (!eda?.pcb_SelectControl || !eda?.pcb_PrimitiveComponent) {
		throw new Error('该功能只能在 PCB 编辑器中使用，请先打开 PCB 文档。');
	}

	const selectedPrimitives = await eda.pcb_SelectControl.getAllSelectedPrimitives();
	const componentPrimitiveIds = new Set<string>();

	for (const primitive of asArray(selectedPrimitives)) {
		const runtimePrimitive = primitive as any;
		const primitiveType = String(runtimePrimitive?.getState_PrimitiveType?.() || '');
		if (primitiveType === 'Component') {
			const primitiveId = runtimePrimitive?.getState_PrimitiveId?.();
			if (typeof primitiveId === 'string' && primitiveId.length > 0) {
				componentPrimitiveIds.add(primitiveId);
			}
			continue;
		}

		if (primitiveType === 'ComponentPad') {
			const parentComponentPrimitiveId = runtimePrimitive?.getState_ParentComponentPrimitiveId?.();
			if (typeof parentComponentPrimitiveId === 'string' && parentComponentPrimitiveId.length > 0) {
				componentPrimitiveIds.add(parentComponentPrimitiveId);
			}
		}
	}

	if (componentPrimitiveIds.size === 0) {
		return [];
	}

	return asArray(await eda.pcb_PrimitiveComponent.get([...componentPrimitiveIds]));
}

async function buildHeaderComponent(component: any): Promise<HeaderComponent | undefined> {
	const pads = asArray(await component.getAllPins?.());
	if (pads.length < 2) {
		return undefined;
	}

	const designator = getComponentDisplayName(component);
	const componentPadStates = asArray(component.getState_Pads?.() || []);
	const componentPadStateByPrimitiveId = new Map<string, { net?: string; padNumber?: string }>();
	const componentPadStateByPadNumber = new Map<string, { net?: string; primitiveId?: string }>();
	for (const item of componentPadStates) {
		const primitiveId = normalizeText(String(item?.primitiveId || ''));
		const padNumber = normalizeText(String(item?.padNumber || ''));
		const net = normalizeText(String(item?.net || ''));
		if (primitiveId) {
			componentPadStateByPrimitiveId.set(primitiveId, { net, padNumber });
		}
		if (padNumber) {
			componentPadStateByPadNumber.set(padNumber, { net, primitiveId });
		}
	}

	const componentLayer = Number(component.getState_Layer?.() ?? PCB_LAYER_TOP);
	const textLayer = componentLayer === PCB_LAYER_BOTTOM ? PCB_LAYER_BOTTOM_SILK : PCB_LAYER_TOP_SILK;
	const mirror = componentLayer === PCB_LAYER_BOTTOM;
	const axis = getAxis(pads.map((pad: any) => ({ x: Number(pad.getState_X?.() ?? 0), y: Number(pad.getState_Y?.() ?? 0) })));

	const padItems = pads.map((pad: any) => {
		const x = Number(pad.getState_X?.() ?? 0);
		const y = Number(pad.getState_Y?.() ?? 0);
		const primitiveId = normalizeText(String(pad.getState_PrimitiveId?.() || ''));
		const padNumber = normalizeText(String(pad.getState_PadNumber?.() || ''));
		const stateByPrimitiveId = componentPadStateByPrimitiveId.get(primitiveId);
		const stateByPadNumber = componentPadStateByPadNumber.get(padNumber);
		const netName = normalizeText(String(
			pad.getState_Net?.()
			|| stateByPrimitiveId?.net
			|| stateByPadNumber?.net
			|| '',
		));

		return {
			padNumber,
			netName,
			silkLabel: makeSilkLabel(netName, padNumber),
			x,
			y,
			padShape: pad.getState_Pad?.(),
			majorProjection: dot({ x: x - axis.center.x, y: y - axis.center.y }, axis.major),
			minorProjection: dot({ x: x - axis.center.x, y: y - axis.center.y }, axis.minor),
			rowIndex: 0,
		} satisfies HeaderPad;
	});

	const padExtent = median(padItems.map(item => getPadExtent(item.padShape)).filter(size => size > 0));
	const pitch = estimatePitch(padItems.map(item => item.majorProjection));
	const baseSize = padExtent || pitch || 1.27;
	const rowTolerance = Math.max(baseSize * 0.6, pitch * 0.35 || 0);
	const rows = clusterRows(padItems, rowTolerance || baseSize * 0.6);
	const labelOffset = Math.max(baseSize * 1.4, pitch * 0.9 || 0);
	const fontSize = Math.max(baseSize * 0.9, pitch * 0.65 || 0);
	const lineWidth = Math.max(baseSize * 0.14, fontSize * 0.12);
	const recognizedNetCount = padItems.filter(item => item.netName.length > 0).length;

	return {
		component,
		componentId: String(component.getState_PrimitiveId?.() || ''),
		designator,
		padCount: padItems.length,
		recognizedNetCount,
		componentLayer,
		textLayer,
		mirror,
		textRotation: getTextRotation(axis),
		labelOffset,
		fontSize,
		lineWidth,
		nominalPitch: pitch || baseSize,
		axis,
		rows,
		pads: padItems,
	};
}

function getRowOffsetSign(row: HeaderRow, rows: Array<HeaderRow>): number {
	if (rows.length === 1) {
		return 1;
	}

	const overallMean = rows.reduce((sum, currentRow) => sum + currentRow.meanMinor, 0) / rows.length;
	const offset = row.meanMinor - overallMean;
	if (Math.abs(offset) > 1e-6) {
		return Math.sign(offset);
	}

	return row.index < rows.length / 2 ? -1 : 1;
}

function getHeaderLabelPlacements(header: HeaderComponent): Array<HeaderLabelPlacement> {
	const placements: Array<HeaderLabelPlacement> = [];

	for (const row of header.rows) {
		const offsetSign = getRowOffsetSign(row, header.rows);
		for (const pad of row.pads) {
			if (!pad.silkLabel) {
				continue;
			}

			placements.push({
				text: pad.silkLabel,
				x: pad.x + header.axis.minor.x * header.labelOffset * offsetSign,
				y: pad.y + header.axis.minor.y * header.labelOffset * offsetSign,
				rotation: header.textRotation,
			});
		}
	}

	return placements;
}

async function buildHeaderImagePlacements(header: HeaderComponent): Promise<Array<SilkImagePlacement>> {
	const imagePlacements: Array<SilkImagePlacement> = [];
	const assetCache = new Map<string, Promise<{ complexPolygon: any; imageWidth: number; imageHeight: number }>>();
	const labelPlacements = getHeaderLabelPlacements(header);
	const imageHeight = clamp(header.nominalPitch * 0.4 || header.fontSize * 0.45 || 40, 24, 60);

	for (const placement of labelPlacements) {
		if (!assetCache.has(placement.text)) {
			assetCache.set(placement.text, (async () => {
				const { blob, widthPx, heightPx } = await renderTextToBlob(placement.text);
				const complexPolygon = await eda.pcb_MathPolygon.convertImageToComplexPolygon(
					blob,
					widthPx,
					heightPx,
					0.3,
					0.9,
					1,
					2,
					false,
					false,
				);

				if (!complexPolygon) {
					throw new Error(`文字 "${placement.text}" 转换为丝印图形失败。`);
				}

				return {
					complexPolygon,
					imageWidth: (widthPx / heightPx) * imageHeight,
					imageHeight,
				};
			})());
		}

		const asset = await assetCache.get(placement.text)!;
		const topLeft = getImageTopLeftFromCenter(
			placement.x,
			placement.y,
			asset.imageWidth,
			asset.imageHeight,
			placement.rotation,
		);

		imagePlacements.push({
			...placement,
			topLeftX: topLeft.x,
			topLeftY: topLeft.y,
			imageWidth: asset.imageWidth,
			imageHeight: asset.imageHeight,
			complexPolygon: asset.complexPolygon,
		});
	}

	return imagePlacements;
}

async function deleteExistingHeaderSilk(textLayer: number, placements: Array<SilkImagePlacement>): Promise<number> {
	const existingImages = asArray(await eda.pcb_PrimitiveImage.getAll(textLayer));
	if (existingImages.length === 0) {
		return 0;
	}

	const imagesToDelete: Array<any> = [];

	for (const existingImage of existingImages) {
		const existingX = Number(existingImage.getState_X?.() ?? Number.NaN);
		const existingY = Number(existingImage.getState_Y?.() ?? Number.NaN);
		const existingWidth = Number(existingImage.getState_Width?.() ?? Number.NaN);
		const existingHeight = Number(existingImage.getState_Height?.() ?? Number.NaN);
		const existingRotation = Number(existingImage.getState_Rotation?.() ?? Number.NaN);

		const matchedPlacement = placements.find((placement) => {
			if (Math.abs(existingRotation - placement.rotation) > 1) {
				return false;
			}

			const tolerance = Math.max(Math.min(placement.imageWidth, placement.imageHeight) * 0.2, 1);
			if (Math.abs(existingWidth - placement.imageWidth) > tolerance) {
				return false;
			}

			if (Math.abs(existingHeight - placement.imageHeight) > tolerance) {
				return false;
			}

			return Math.hypot(existingX - placement.topLeftX, existingY - placement.topLeftY) <= tolerance;
		});

		if (matchedPlacement) {
			imagesToDelete.push(existingImage);
		}
	}

	if (imagesToDelete.length === 0) {
		return 0;
	}

	await eda.pcb_PrimitiveImage.delete(imagesToDelete);
	return imagesToDelete.length;
}

async function createSilkForHeader(header: HeaderComponent): Promise<number> {
	const placements = await buildHeaderImagePlacements(header);
	await deleteExistingHeaderSilk(header.textLayer, placements);

	let createdCount = 0;

	for (const placement of placements) {
		const createdImage = await eda.pcb_PrimitiveImage.create(
			placement.topLeftX,
			placement.topLeftY,
			placement.complexPolygon,
			header.textLayer,
			placement.imageWidth,
			placement.imageHeight,
			placement.rotation,
			false,
			false,
		);

		if (createdImage) {
			createdCount += 1;
		}
	}

	return createdCount;
}

function showMessage(content: string, title = '排针网络丝印'): void {
	eda.sys_Dialog.showInformationMessage(content, title);
}

function formatSkipped(skippedDesignators: Array<string>): string {
	if (skippedDesignators.length === 0) {
		return '';
	}

	return `\n未处理：${skippedDesignators.join('、')}`;
}

async function resolveSelectedHeaders(): Promise<{
	components: Array<any>;
	headers: Array<HeaderComponent>;
	skippedDesignators: Array<string>;
}> {
	const components = await getSelectedComponents();
	const headers = (await Promise.all(components.map(buildHeaderComponent))).filter((item): item is HeaderComponent => Boolean(item));
	const skippedDesignators = components
		.map(getComponentDisplayName)
		.filter(designator => !headers.some(header => header.designator === designator));

	return {
		components,
		headers,
		skippedDesignators,
	};
}

export async function generateSelectedHeaderSilkOnly(): Promise<void> {
	try {
		const { components, headers } = await resolveSelectedHeaders();
		if (components.length === 0) {
			showMessage('请先在 PCB 中选中一个排针器件，或选中该排针的任意焊盘。');
			return;
		}

		if (headers.length === 0) {
			showMessage('当前选中的对象没有可用的排针焊盘数据，无法生成丝印。');
			return;
		}

		if (headers.length > 1) {
			showMessage(`请只选择一个排针器件，当前识别到 ${headers.length} 个器件。`);
			return;
		}

		const header = headers[0];
		const totalCreated = await createSilkForHeader(header);
		if (totalCreated === 0) {
			showMessage(
				[
					`已识别器件：${header.designator}`,
					`焊盘数量：${header.padCount}`,
					`带网络焊盘：${header.recognizedNetCount}`,
					`网络预览：${getHeaderPadPreview(header) || '无'}`,
					'没有成功生成任何丝印图元。',
				].join('\n'),
			);
			return;
		}

		showMessage(
			[
				`已处理器件：${header.designator}`,
				`焊盘数量：${header.padCount}，带网络焊盘：${header.recognizedNetCount}`,
				`网络预览：${getHeaderPadPreview(header) || '无'}`,
				`已生成丝印文字：${totalCreated} 条`,
				'再次执行会先清理同位置、同文本的旧丝印，再重新生成。',
			].join('\n'),
		);
	}
	catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showMessage(`执行失败：${message}`);
	}
}
