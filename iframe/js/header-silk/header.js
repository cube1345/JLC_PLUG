import {
	MAX_HEADER_GEOMETRY_CACHE,
	MAX_HEADER_PARSE_CACHE,
	PCB_LAYER_BOTTOM,
	PCB_LAYER_BOTTOM_SILK,
	PCB_LAYER_TOP,
	PCB_LAYER_TOP_SILK,
	asArray,
	clusterRows,
	createHeaderGeometryCacheKey,
	createHeaderParseCacheKey,
	dot,
	estimatePitch,
	estimateShellBounds,
	getAxis,
	getComponentDisplayName,
	getPadExtent,
	getTextRotation,
	headerGeometryCache,
	headerParseCache,
	makeSilkLabel,
	median,
	normalizeText,
	rememberBoundedCache,
} from './shared.js';

async function getSelectedComponents() {
		if (!eda.pcb_SelectControl || !eda.pcb_PrimitiveComponent) {
			throw new Error('请在 PCB 中使用。');
		}

		const selectedPrimitives = await eda.pcb_SelectControl.getAllSelectedPrimitives();
		const componentPrimitiveIds = new Set();

		for (const primitive of asArray(selectedPrimitives)) {
			const primitiveType = String(primitive.getState_PrimitiveType && primitive.getState_PrimitiveType());
			if (primitiveType === 'Component') {
				const primitiveId = primitive.getState_PrimitiveId && primitive.getState_PrimitiveId();
				if (primitiveId) {
					componentPrimitiveIds.add(primitiveId);
				}
				continue;
			}

			if (primitiveType === 'ComponentPad') {
				const parentComponentPrimitiveId = primitive.getState_ParentComponentPrimitiveId && primitive.getState_ParentComponentPrimitiveId();
				if (parentComponentPrimitiveId) {
					componentPrimitiveIds.add(parentComponentPrimitiveId);
				}
			}
		}

		if (!componentPrimitiveIds.size) {
			return [];
		}

		return asArray(await eda.pcb_PrimitiveComponent.get(Array.from(componentPrimitiveIds)));
}

export {
	buildHeaderComponent,
	getSelectedComponents,
};

	function getHeaderPadCacheKey(primitiveId, padNumber) {
		const normalizedPrimitiveId = normalizeText(primitiveId);
		const normalizedPadNumber = normalizeText(padNumber);
		return normalizedPrimitiveId || `pad-number:${normalizedPadNumber}`;
	}

	function buildComponentPadStateMaps(componentPadStates) {
		const componentPadStateByPrimitiveId = new Map();
		const componentPadStateByPadNumber = new Map();
		for (const item of componentPadStates) {
			const primitiveId = normalizeText(item && item.primitiveId);
			const padNumber = normalizeText(item && item.padNumber);
			const net = normalizeText(item && item.net);
			if (primitiveId) {
				componentPadStateByPrimitiveId.set(primitiveId, { net, padNumber });
			}
			if (padNumber) {
				componentPadStateByPadNumber.set(padNumber, { net, primitiveId });
			}
		}
		return {
			componentPadStateByPrimitiveId,
			componentPadStateByPadNumber,
		};
	}

	function createHeaderFromGeometry(geometry, designator, componentPadStates) {
		const {
			componentPadStateByPrimitiveId,
			componentPadStateByPadNumber,
		} = buildComponentPadStateMaps(componentPadStates);
		const padItems = geometry.basePads.map((basePad) => {
			const stateByPrimitiveId = componentPadStateByPrimitiveId.get(basePad.primitiveId);
			const stateByPadNumber = componentPadStateByPadNumber.get(basePad.padNumber);
			const netName = normalizeText(
				(stateByPrimitiveId && stateByPrimitiveId.net)
				|| (stateByPadNumber && stateByPadNumber.net)
				|| '',
			);

			return {
				primitiveId: basePad.primitiveId,
				padNumber: basePad.padNumber,
				netName,
				silkLabel: makeSilkLabel(netName, basePad.padNumber),
				x: basePad.x,
				y: basePad.y,
				padShape: basePad.padShape,
				majorProjection: basePad.majorProjection,
				minorProjection: basePad.minorProjection,
				rowIndex: basePad.rowIndex,
				cachePadKey: basePad.cachePadKey,
			};
		});
		const padItemByCacheKey = new Map(padItems.map((padItem) => [padItem.cachePadKey, padItem]));
		const rows = geometry.rowDefinitions.map((rowDefinition) => ({
			index: rowDefinition.index,
			meanMinor: rowDefinition.meanMinor,
			pads: rowDefinition.padKeys
				.map((padKey) => padItemByCacheKey.get(padKey))
				.filter(Boolean),
		}));
		const recognizedNetCount = padItems.filter((item) => item.netName.length > 0).length;

		return {
			componentId: geometry.componentId,
			designator,
			padCount: padItems.length,
			recognizedNetCount,
			componentLayer: geometry.componentLayer,
			defaultTextLayer: geometry.defaultTextLayer,
			textRotation: geometry.textRotation,
			nominalPitch: geometry.nominalPitch,
			padExtent: geometry.padExtent,
			axis: geometry.axis,
			shellBounds: geometry.shellBounds,
			rows,
			pads: padItems,
		};
	}

	async function buildHeaderComponent(component) {
		const componentId = String(component.getState_PrimitiveId && component.getState_PrimitiveId());
		const designator = getComponentDisplayName(component);
		const componentPadStates = asArray(component.getState_Pads && component.getState_Pads());
		const componentLayer = Number(component.getState_Layer && component.getState_Layer()) || PCB_LAYER_TOP;
		const componentX = Number(component.getState_X && component.getState_X()) || 0;
		const componentY = Number(component.getState_Y && component.getState_Y()) || 0;
		const componentRotation = Number(component.getState_Rotation && component.getState_Rotation()) || 0;
		const geometryCacheKey = createHeaderGeometryCacheKey(
			componentId,
			componentLayer,
			componentX,
			componentY,
			componentRotation,
			componentPadStates,
		);
		const cacheKey = createHeaderParseCacheKey(
			componentId,
			componentLayer,
			componentX,
			componentY,
			componentRotation,
			componentPadStates,
		);
		const cachedHeader = headerParseCache.get(cacheKey);
		if (cachedHeader) {
			rememberBoundedCache(headerParseCache, cacheKey, cachedHeader, MAX_HEADER_PARSE_CACHE);
			return cachedHeader;
		}

		const cachedGeometry = headerGeometryCache.get(geometryCacheKey);
		if (cachedGeometry) {
			rememberBoundedCache(headerGeometryCache, geometryCacheKey, cachedGeometry, MAX_HEADER_GEOMETRY_CACHE);
			const header = createHeaderFromGeometry(cachedGeometry, designator, componentPadStates);
			rememberBoundedCache(headerParseCache, cacheKey, header, MAX_HEADER_PARSE_CACHE);
			return header;
		}

		const pads = asArray(await component.getAllPins());
		if (pads.length < 2) {
			return undefined;
		}

		const {
			componentPadStateByPrimitiveId,
		} = buildComponentPadStateMaps(componentPadStates);

		const textLayer = componentLayer === PCB_LAYER_BOTTOM ? PCB_LAYER_BOTTOM_SILK : PCB_LAYER_TOP_SILK;
		const basePads = pads.map((pad) => {
			const x = Number(pad.getState_X && pad.getState_X()) || 0;
			const y = Number(pad.getState_Y && pad.getState_Y()) || 0;
			const primitiveId = normalizeText(pad.getState_PrimitiveId && pad.getState_PrimitiveId());
			const stateByPrimitiveId = componentPadStateByPrimitiveId.get(primitiveId);
			const padNumber = normalizeText(
				(stateByPrimitiveId && stateByPrimitiveId.padNumber)
				|| (pad.getState_PadNumber && pad.getState_PadNumber()),
			);

			return {
				cachePadKey: getHeaderPadCacheKey(primitiveId, padNumber),
				primitiveId,
				padNumber,
				x,
				y,
				padShape: pad.getState_Pad && pad.getState_Pad(),
				majorProjection: 0,
				minorProjection: 0,
				rowIndex: 0,
			};
		});
		const axis = getAxis(basePads.map((pad) => ({
			x: pad.x,
			y: pad.y,
		})));
		for (const basePad of basePads) {
			basePad.majorProjection = dot({ x: basePad.x - axis.center.x, y: basePad.y - axis.center.y }, axis.major);
			basePad.minorProjection = dot({ x: basePad.x - axis.center.x, y: basePad.y - axis.center.y }, axis.minor);
		}

		const padExtent = median(basePads.map((item) => getPadExtent(item.padShape)).filter((size) => size > 0));
		const pitch = estimatePitch(basePads.map((item) => item.majorProjection));
		const baseSize = padExtent || pitch || 1.27;
		const rowTolerance = Math.max(baseSize * 0.6, (pitch * 0.35) || 0);
		const rows = clusterRows(basePads, rowTolerance || baseSize * 0.6);
		const shellBounds = estimateShellBounds(basePads, rows, pitch || baseSize, padExtent || baseSize);
		const geometry = {
			componentId,
			componentLayer,
			defaultTextLayer: textLayer,
			textRotation: getTextRotation(axis),
			nominalPitch: pitch || baseSize,
			padExtent: padExtent || baseSize,
			axis,
			shellBounds,
			basePads: basePads.map((basePad) => ({
				cachePadKey: basePad.cachePadKey,
				primitiveId: basePad.primitiveId,
				padNumber: basePad.padNumber,
				x: basePad.x,
				y: basePad.y,
				padShape: basePad.padShape,
				majorProjection: basePad.majorProjection,
				minorProjection: basePad.minorProjection,
				rowIndex: basePad.rowIndex,
			})),
			rowDefinitions: rows.map((row) => ({
				index: row.index,
				meanMinor: row.meanMinor,
				padKeys: row.pads.map((pad) => pad.cachePadKey),
			})),
		};
		rememberBoundedCache(headerGeometryCache, geometryCacheKey, geometry, MAX_HEADER_GEOMETRY_CACHE);
		const header = createHeaderFromGeometry(geometry, designator, componentPadStates);
		rememberBoundedCache(headerParseCache, cacheKey, header, MAX_HEADER_PARSE_CACHE);
		return header;
	}
