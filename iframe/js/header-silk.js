(function () {
	const STORAGE_KEY = 'header_silk_settings_v2';
	const PANEL_ID = 'header-silk-panel';
	const PCB_LAYER_TOP = 1;
	const PCB_LAYER_BOTTOM = 2;
	const PCB_LAYER_TOP_SILK = 3;
	const PCB_LAYER_BOTTOM_SILK = 4;
	const TEXT_RENDER_FONT_PX = 192;
	const TEXT_RENDER_PADDING_X_PX = 12;
	const TEXT_RENDER_PADDING_Y_PX = 10;
	const TEXT_RENDER_MARGIN_X_MIL = 6;
	const TEXT_RENDER_MARGIN_Y_MIL = 8;
	const RANGE_SELECTION_EVENT_ID = 'header-silk-range-select';
	const MIN_RANGE_SELECTION_DISTANCE = 5;

	const DEFAULT_SETTINGS = {
		fontFamily: '黑体',
		unitMode: 'mil',
		layerMode: 'auto',
		fontSizeMil: 40,
		strokeWidthMil: 4,
		positionMode: 'auto',
		rotationMode: 'auto',
		offsetMil: 18,
		includeShell: false,
		invert: false,
	};

	const elements = {
		panelSubtitle: document.getElementById('panel-subtitle'),
		fontFamily: document.getElementById('font-family'),
		unitMode: document.getElementById('unit-mode'),
		layerMode: document.getElementById('layer-mode'),
		fontSize: document.getElementById('font-size'),
		fontSizeUnit: document.getElementById('font-size-unit'),
		strokeWidth: document.getElementById('stroke-width'),
		strokeWidthUnit: document.getElementById('stroke-width-unit'),
		positionMode: document.getElementById('position-mode'),
		rotationMode: document.getElementById('rotation-mode'),
		offset: document.getElementById('offset'),
		offsetUnit: document.getElementById('offset-unit'),
		includeShell: document.getElementById('include-shell'),
		invert: document.getElementById('invert'),
		reset: document.getElementById('reset'),
		generate: document.getElementById('generate'),
		previewCanvas: document.getElementById('preview-canvas'),
		previewSummary: document.getElementById('preview-summary'),
		placementStage: document.getElementById('placement-stage'),
		placementMeta: document.getElementById('placement-meta'),
		placementStatus: document.getElementById('placement-status'),
		confirmPlacement: document.getElementById('confirm-placement'),
		cancelPlacement: document.getElementById('cancel-placement'),
	};

	let currentSettings = loadSettings();

	function asArray(value) {
		if (Array.isArray(value)) {
			return value;
		}
		return value == null ? [] : [value];
	}

	function normalizeText(text) {
		return String(text || '').replace(/\s+/g, ' ').trim();
	}

	function clamp(value, min, max) {
		return Math.min(Math.max(value, min), max);
	}

	function milToMm(value) {
		return value * 0.0254;
	}

	function mmToMil(value) {
		return value / 0.0254;
	}

	function formatNumeric(value) {
		const rounded = Math.round(value * 1000) / 1000;
		return Number.isInteger(rounded) ? String(rounded) : String(rounded);
	}

	function toDisplayValue(valueMil, unitMode) {
		return unitMode === 'mm' ? milToMm(valueMil) : valueMil;
	}

	function fromDisplayValue(value, unitMode) {
		return unitMode === 'mm' ? mmToMil(value) : value;
	}

	function dot(a, b) {
		return a.x * b.x + a.y * b.y;
	}

	function normalizeVector(vector) {
		const length = Math.hypot(vector.x, vector.y);
		if (length <= 1e-9) {
			return { x: 1, y: 0 };
		}
		return {
			x: vector.x / length,
			y: vector.y / length,
		};
	}

	function getAxis(points) {
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

	function median(values) {
		if (!values.length) {
			return 0;
		}
		const sorted = [...values].sort((a, b) => a - b);
		const middle = Math.floor(sorted.length / 2);
		if (sorted.length % 2 === 0) {
			return (sorted[middle - 1] + sorted[middle]) / 2;
		}
		return sorted[middle];
	}

	function getSortedUnique(values, tolerance) {
		const sorted = [...values].sort((a, b) => a - b);
		const unique = [];
		for (const value of sorted) {
			if (!unique.length || Math.abs(value - unique[unique.length - 1]) > tolerance) {
				unique.push(value);
			}
		}
		return unique;
	}

	function getPadExtent(padShape) {
		if (!Array.isArray(padShape)) {
			return 0;
		}
		const numericValues = padShape.filter((item) => typeof item === 'number' && Number.isFinite(item));
		if (!numericValues.length) {
			return 0;
		}
		return Math.max.apply(null, numericValues);
	}

	function estimatePitch(projections) {
		const unique = getSortedUnique(projections, 1e-6);
		if (unique.length < 2) {
			return 0;
		}

		const diffs = [];
		for (let index = 1; index < unique.length; index += 1) {
			const diff = unique[index] - unique[index - 1];
			if (diff > 1e-6) {
				diffs.push(diff);
			}
		}

		return median(diffs);
	}

	function clusterRows(pads, tolerance) {
		const sortedPads = [...pads].sort((a, b) => a.minorProjection - b.minorProjection);
		const rows = [];

		for (const pad of sortedPads) {
			const currentRow = rows[rows.length - 1];
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

	function getTextRotation(axis) {
		return Math.abs(axis.major.x) >= Math.abs(axis.major.y) ? 0 : 90;
	}

	function getPadHalfSpan(padShape) {
		return getPadExtent(padShape) / 2;
	}

	function projectPoint(axis, majorValue, minorValue) {
		return {
			x: axis.center.x + axis.major.x * majorValue + axis.minor.x * minorValue,
			y: axis.center.y + axis.major.y * majorValue + axis.minor.y * minorValue,
		};
	}

	function estimateShellBounds(pads, rows, nominalPitch, padExtent) {
		const majorPadMin = Math.min(...pads.map((pad) => pad.majorProjection - getPadHalfSpan(pad.padShape)));
		const majorPadMax = Math.max(...pads.map((pad) => pad.majorProjection + getPadHalfSpan(pad.padShape)));
		const minorPadMin = Math.min(...pads.map((pad) => pad.minorProjection - getPadHalfSpan(pad.padShape)));
		const minorPadMax = Math.max(...pads.map((pad) => pad.minorProjection + getPadHalfSpan(pad.padShape)));
		const majorCenterMin = Math.min(...pads.map((pad) => pad.majorProjection));
		const majorCenterMax = Math.max(...pads.map((pad) => pad.majorProjection));
		const basePitch = nominalPitch || padExtent || 40;
		const basePad = padExtent || basePitch;
		const endMargin = clamp(Math.max(basePitch * 0.14, basePad * 0.1, 4), 4, 14);
		const endClearance = clamp(Math.max(basePad * 0.08, 2), 2, 8);
		const majorMin = Math.min(majorCenterMin - endMargin, majorPadMin - endClearance);
		const majorMax = Math.max(majorCenterMax + endMargin, majorPadMax + endClearance);

		return {
			majorMin,
			majorMax,
			minorMin: minorPadMin,
			minorMax: minorPadMax,
		};
	}

	function makeSilkLabel(netName, padNumber) {
		const normalizedNet = normalizeText(netName);
		if (!normalizedNet) {
			return `P${padNumber || '?'}`;
		}

		const slashSegments = normalizedNet.split('/').filter(Boolean);
		const tail = slashSegments.length ? slashSegments[slashSegments.length - 1] : normalizedNet;
		const dotSegments = tail.split('.').filter(Boolean);
		const compact = normalizeText(dotSegments.length ? dotSegments[dotSegments.length - 1] : tail);
		return compact || normalizedNet;
	}

	function getComponentDisplayName(component) {
		const designator = normalizeText(component.getState_Designator && component.getState_Designator());
		if (designator) {
			return designator;
		}
		const name = normalizeText(component.getState_Name && component.getState_Name());
		if (name) {
			return name;
		}
		return normalizeText(component.getState_PrimitiveId && component.getState_PrimitiveId()) || 'HEADER';
	}

	function getHeaderPadPreview(header, maxItems) {
		return header.pads.slice(0, maxItems || 6).map((pad) => `${pad.padNumber}:${pad.netName || pad.silkLabel}`).join('，');
	}

	function getPlacementMeta(header) {
		return `${header.designator}`;
	}

	function getLayerLabel(layerMode, header) {
		if (layerMode === 'top') {
			return '顶层';
		}
		if (layerMode === 'bottom') {
			return '底层';
		}
		return header && header.componentLayer === PCB_LAYER_BOTTOM ? '底层' : '顶层';
	}

	function loadSettings() {
		try {
			const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
			return { ...DEFAULT_SETTINGS, ...(saved || {}) };
		}
		catch {
			return { ...DEFAULT_SETTINGS };
		}
	}

	function saveSettings(settings) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	}

	function refreshUnitBadges(unitMode) {
		elements.fontSizeUnit.textContent = unitMode;
		elements.strokeWidthUnit.textContent = unitMode;
		elements.offsetUnit.textContent = unitMode;
	}

	function refreshNumericConstraints(unitMode) {
		if (unitMode === 'mm') {
			elements.fontSize.min = '0.254';
			elements.fontSize.step = '0.01';
			elements.strokeWidth.min = '0';
			elements.strokeWidth.step = '0.01';
			elements.offset.min = '0.0254';
			elements.offset.step = '0.01';
			return;
		}

		elements.fontSize.min = '10';
		elements.fontSize.step = '1';
		elements.strokeWidth.min = '0';
		elements.strokeWidth.step = '0.1';
		elements.offset.min = '1';
		elements.offset.step = '1';
	}

	function applySettings(settings) {
		elements.fontFamily.value = settings.fontFamily;
		elements.unitMode.value = settings.unitMode;
		elements.layerMode.value = settings.layerMode;
		refreshNumericConstraints(settings.unitMode);
		elements.fontSize.value = formatNumeric(toDisplayValue(settings.fontSizeMil, settings.unitMode));
		elements.strokeWidth.value = formatNumeric(toDisplayValue(settings.strokeWidthMil, settings.unitMode));
		elements.positionMode.value = settings.positionMode;
		elements.rotationMode.value = settings.rotationMode;
		elements.offset.value = formatNumeric(toDisplayValue(settings.offsetMil, settings.unitMode));
		elements.includeShell.checked = Boolean(settings.includeShell);
		elements.invert.checked = Boolean(settings.invert);
		refreshUnitBadges(settings.unitMode);
		renderPreview();
	}

	function syncSettingsFromForm() {
		currentSettings.fontFamily = elements.fontFamily.value || DEFAULT_SETTINGS.fontFamily;
		currentSettings.layerMode = elements.layerMode.value || DEFAULT_SETTINGS.layerMode;
		currentSettings.fontSizeMil = clamp(fromDisplayValue(Number(elements.fontSize.value) || 0, currentSettings.unitMode), 10, 240);
		currentSettings.strokeWidthMil = clamp(fromDisplayValue(Number(elements.strokeWidth.value) || 0, currentSettings.unitMode), 0, 80);
		currentSettings.positionMode = elements.positionMode.value || DEFAULT_SETTINGS.positionMode;
		currentSettings.rotationMode = elements.rotationMode.value || DEFAULT_SETTINGS.rotationMode;
		currentSettings.offsetMil = clamp(fromDisplayValue(Number(elements.offset.value) || 0, currentSettings.unitMode), 1, 300);
		currentSettings.includeShell = elements.includeShell.checked;
		currentSettings.invert = elements.invert.checked;
		saveSettings(currentSettings);
	}

	function drawRoundedRect(context, x, y, width, height, radius) {
		context.beginPath();
		context.moveTo(x + radius, y);
		context.arcTo(x + width, y, x + width, y + height, radius);
		context.arcTo(x + width, y + height, x, y + height, radius);
		context.arcTo(x, y + height, x, y, radius);
		context.arcTo(x, y, x + width, y, radius);
		context.closePath();
	}

	function drawPreviewCrosshair(context, centerX, centerY) {
		context.save();
		context.strokeStyle = 'rgba(158, 79, 29, 0.5)';
		context.lineWidth = 1;
		context.setLineDash([4, 4]);
		context.beginPath();
		context.moveTo(centerX - 44, centerY);
		context.lineTo(centerX + 44, centerY);
		context.moveTo(centerX, centerY - 44);
		context.lineTo(centerX, centerY + 44);
		context.stroke();
		context.setLineDash([]);

		context.fillStyle = '#9e4f1d';
		context.beginPath();
		context.arc(centerX, centerY, 3, 0, Math.PI * 2);
		context.fill();

		context.font = '12px "Microsoft YaHei", sans-serif';
		context.fillStyle = 'rgba(107, 90, 72, 0.95)';
		context.fillText('落点', centerX + 10, centerY - 10);
		context.restore();
	}

	function getPreviewRotation(settings, orientation) {
		if (settings.rotationMode === 'auto') {
			return orientation === 'vertical' ? 90 : 0;
		}
		return Number(settings.rotationMode) || 0;
	}

	function drawPreviewLabel(context, text, centerX, centerY, rotation, settings, previewImageHeightPx, metrics) {
		const pixelScale = previewImageHeightPx / Math.max(metrics.canvasHeightPx, 1);
		const fontPx = Math.max(TEXT_RENDER_FONT_PX * pixelScale, 9);
		const strokePx = metrics.strokeWidthPx <= 0
			? 0
			: Math.max(metrics.strokeWidthPx * pixelScale, 0.5);
		context.save();
		context.translate(centerX, centerY);
		context.rotate((rotation * Math.PI) / 180);
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.font = `600 ${fontPx}px "${settings.fontFamily}", sans-serif`;
		context.lineJoin = 'round';
		context.lineCap = 'round';
		context.lineWidth = strokePx;

		const textWidth = Math.max(context.measureText(text).width, fontPx * 1.2);
		const paddingX = Math.max(metrics.paddingXPx * pixelScale - strokePx, 3) + strokePx;
		const paddingY = Math.max(metrics.paddingYPx * pixelScale - strokePx, 2.5) + strokePx;
		const boxWidth = textWidth + paddingX * 2;
		const boxHeight = fontPx + paddingY * 2;

		if (settings.invert) {
			drawRoundedRect(context, -boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, 10);
			context.fillStyle = '#3a2b1b';
			context.fill();
			context.fillStyle = '#fff8ef';
			context.strokeStyle = '#fff8ef';
		}
		else {
			context.fillStyle = '#2a2015';
			context.strokeStyle = '#2a2015';
		}

		if (strokePx > 0) {
			context.strokeText(text, 0, 1);
		}
		context.fillText(text, 0, 1);
		context.restore();
	}

	function renderPreview() {
		const canvas = elements.previewCanvas;
		const summary = elements.previewSummary;
		if (!canvas || !summary) {
			return;
		}

		const context = canvas.getContext('2d');
		if (!context) {
			return;
		}

		const width = canvas.width;
		const height = canvas.height;
		const centerX = width / 2;
		const centerY = height / 2;
		const labels = ['3V3', 'SCL', 'TX', 'RX', 'GND'];
		const orientation = currentSettings.positionMode === 'left' || currentSettings.positionMode === 'right'
			? 'vertical'
			: 'horizontal';
		const previewRotation = getPreviewRotation(currentSettings, orientation);
		const textMetrics = getTextSourceMetrics(currentSettings);
		const previewImageHeightPx = clamp(currentSettings.fontSizeMil * 0.48, 16, 42);
		const previewStrokePx = textMetrics.strokeWidthPx <= 0
			? 0
			: Math.max((previewImageHeightPx / Math.max(textMetrics.canvasHeightPx, 1)) * textMetrics.strokeWidthPx, 0.5);
		const offsetPx = clamp(currentSettings.offsetMil * 0.55, 14, 56);

		context.clearRect(0, 0, width, height);
		drawPreviewCrosshair(context, centerX, centerY);

		context.save();
		context.fillStyle = 'rgba(73, 57, 38, 0.08)';
		context.strokeStyle = 'rgba(73, 57, 38, 0.18)';
		context.lineWidth = 1.2;

		const bodyWidth = orientation === 'horizontal' ? 208 : 38;
		const bodyHeight = orientation === 'horizontal' ? 36 : 152;
		drawRoundedRect(context, centerX - bodyWidth / 2, centerY - bodyHeight / 2, bodyWidth, bodyHeight, 14);
		context.fill();
		context.stroke();

		context.font = '12px "Microsoft YaHei", sans-serif';
		context.fillStyle = 'rgba(73, 57, 38, 0.8)';
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.fillText('预览', centerX, centerY);
		context.restore();

		if (currentSettings.includeShell) {
			context.save();
			context.strokeStyle = 'rgba(43, 32, 21, 0.8)';
			context.lineWidth = Math.max(previewStrokePx, 1.2);
			drawRoundedRect(
				context,
				centerX - bodyWidth / 2 - 12,
				centerY - bodyHeight / 2 - 12,
				bodyWidth + 24,
				bodyHeight + 24,
				12,
			);
			context.stroke();
			context.restore();
		}

		let direction = { x: 0, y: -1 };
		switch (currentSettings.positionMode) {
			case 'bottom':
				direction = { x: 0, y: 1 };
				break;
			case 'left':
				direction = { x: -1, y: 0 };
				break;
			case 'right':
				direction = { x: 1, y: 0 };
				break;
			default:
				direction = orientation === 'horizontal' ? { x: 0, y: -1 } : { x: 1, y: 0 };
				break;
		}

		const padGap = orientation === 'horizontal' ? 42 : 30;
		const padStart = -((labels.length - 1) * padGap) / 2;

		for (let index = 0; index < labels.length; index += 1) {
			const padX = orientation === 'horizontal' ? centerX + padStart + index * padGap : centerX;
			const padY = orientation === 'horizontal' ? centerY : centerY + padStart + index * padGap;

			context.save();
			context.fillStyle = '#b67643';
			context.beginPath();
			context.arc(padX, padY, 5.5, 0, Math.PI * 2);
			context.fill();
			context.restore();

			const labelX = padX + direction.x * (offsetPx + 22);
			const labelY = padY + direction.y * (offsetPx + 18);

			context.save();
			context.strokeStyle = 'rgba(158, 79, 29, 0.34)';
			context.lineWidth = 1.2;
			context.beginPath();
			context.moveTo(padX, padY);
			context.lineTo(
				padX + direction.x * (offsetPx + 8),
				padY + direction.y * (offsetPx + 8),
			);
			context.stroke();
			context.restore();

			drawPreviewLabel(context, labels[index], labelX, labelY, previewRotation, currentSettings, previewImageHeightPx, textMetrics);
		}

		const fontSizeDisplay = formatNumeric(toDisplayValue(currentSettings.fontSizeMil, currentSettings.unitMode));
		const strokeDisplay = formatNumeric(toDisplayValue(currentSettings.strokeWidthMil, currentSettings.unitMode));
		const offsetDisplay = formatNumeric(toDisplayValue(currentSettings.offsetMil, currentSettings.unitMode));
		const shellText = currentSettings.includeShell ? '，含外框' : '';
		const layerText = currentSettings.layerMode === 'top'
			? '顶层'
			: currentSettings.layerMode === 'bottom'
				? '底层'
				: '自动';
		summary.textContent = `字号 ${fontSizeDisplay} ${currentSettings.unitMode}，粗细 ${strokeDisplay} ${currentSettings.unitMode}，偏移 ${offsetDisplay} ${currentSettings.unitMode}，${layerText}${shellText}。`;
	}

	async function populateFontOptions(settings) {
		const fallbackFonts = ['黑体', '宋体', '微软雅黑', 'Arial', 'sans-serif'];
		let fonts = fallbackFonts;
		try {
			const remoteFonts = await eda.sys_FontManager.getFontsList();
			if (Array.isArray(remoteFonts) && remoteFonts.length > 0) {
				fonts = remoteFonts;
			}
		}
		catch (error) {
			console.error(error);
		}

		const seen = new Set();
		elements.fontFamily.innerHTML = '';
		for (const fontName of fonts.concat(fallbackFonts)) {
			const normalized = normalizeText(fontName);
			if (!normalized || seen.has(normalized)) {
				continue;
			}
			seen.add(normalized);
			const option = document.createElement('option');
			option.value = normalized;
			option.textContent = normalized;
			elements.fontFamily.appendChild(option);
		}

		if (!seen.has(settings.fontFamily)) {
			const option = document.createElement('option');
			option.value = settings.fontFamily;
			option.textContent = settings.fontFamily;
			elements.fontFamily.appendChild(option);
		}
		elements.fontFamily.value = settings.fontFamily;
	}

	function dataUrlToBlob(dataUrl) {
		const base64Data = dataUrl.split(',')[1] || '';
		const byteCharacters = atob(base64Data);
		const byteArray = new Uint8Array(byteCharacters.length);
		for (let index = 0; index < byteCharacters.length; index += 1) {
			byteArray[index] = byteCharacters.charCodeAt(index);
		}
		return new Blob([byteArray], { type: 'image/png' });
	}

	function getImageTopLeftFromCenter(centerX, centerY, width, height, rotation) {
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

	function getTextSourceMetrics(settings) {
		const fontSizeMil = Math.max(Number(settings.fontSizeMil) || 1, 1);
		const requestedStrokeMil = clamp(Number(settings.strokeWidthMil) || 0, 0, fontSizeMil * 0.45);
		const baseHeightPx = Math.ceil(TEXT_RENDER_FONT_PX * 1.2) + TEXT_RENDER_PADDING_Y_PX * 2;
		let strokeWidthPx = 0;
		if (requestedStrokeMil > 0) {
			const denominator = Math.max(1 - (2 * requestedStrokeMil) / fontSizeMil, 0.05);
			strokeWidthPx = (requestedStrokeMil * baseHeightPx / fontSizeMil) / denominator;
		}

		const canvasHeightPx = baseHeightPx + strokeWidthPx * 2;
		const imageScale = fontSizeMil / canvasHeightPx;
		return {
			strokeWidthPx,
			canvasHeightPx,
			imageScale,
			paddingXPx: TEXT_RENDER_PADDING_X_PX + strokeWidthPx,
			paddingYPx: TEXT_RENDER_PADDING_Y_PX + strokeWidthPx,
		};
	}

	function getTextRenderPlan(text, settings) {
		const measureCanvas = document.createElement('canvas');
		const measureContext = measureCanvas.getContext('2d');
		if (!measureContext) {
			throw new Error('生成失败，请重试。');
		}

		const fontSizeMil = Math.max(Number(settings.fontSizeMil) || 1, 1);
		const strokeWidthMil = Math.max(Number(settings.strokeWidthMil) || 0, 0);
		const fontDeclaration = `500 ${TEXT_RENDER_FONT_PX}px "${settings.fontFamily}", sans-serif`;
		measureContext.font = fontDeclaration;
		measureContext.textBaseline = 'alphabetic';

		const measured = measureContext.measureText(text);
		const ascentPx = Math.max(measured.actualBoundingBoxAscent || TEXT_RENDER_FONT_PX * 0.78, 1);
		const descentPx = Math.max(measured.actualBoundingBoxDescent || TEXT_RENDER_FONT_PX * 0.22, 1);
		const leftPx = Math.max(measured.actualBoundingBoxLeft || 0, 0);
		const rightPx = Math.max(measured.actualBoundingBoxRight || measured.width || TEXT_RENDER_FONT_PX * 0.6, 1);
		const fillWidthPx = Math.max(leftPx + rightPx, 1);
		const fillHeightPx = Math.max(ascentPx + descentPx, 1);
		const pxPerMil = fillHeightPx / fontSizeMil;
		const strokeWidthPx = strokeWidthMil * pxPerMil;
		const marginXPx = TEXT_RENDER_MARGIN_X_MIL * pxPerMil;
		const marginYPx = TEXT_RENDER_MARGIN_Y_MIL * pxPerMil;
		const paddingXPx = marginXPx + strokeWidthPx + 1;
		const paddingYPx = marginYPx + strokeWidthPx + 1;
		const canvasWidthPx = Math.ceil(fillWidthPx + paddingXPx * 2);
		const canvasHeightPx = Math.ceil(fillHeightPx + paddingYPx * 2);

		return {
			fontDeclaration,
			ascentPx,
			leftPx,
			fillWidthPx,
			fillHeightPx,
			pxPerMil,
			strokeWidthPx,
			marginXPx,
			marginYPx,
			paddingXPx,
			paddingYPx,
			canvasWidthPx,
			canvasHeightPx,
			imageWidthMil: canvasWidthPx / pxPerMil,
			imageHeightMil: canvasHeightPx / pxPerMil,
		};
	}

	async function renderTextToBlob(text, settings) {
		const plan = getTextRenderPlan(text, settings);
		const strokeWidthPx = plan.strokeWidthPx;

		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('生成失败，请重试。');
		}

		canvas.width = plan.canvasWidthPx;
		canvas.height = plan.canvasHeightPx;

		const drawContext = canvas.getContext('2d');
		if (!drawContext) {
			throw new Error('生成失败，请重试。');
		}

		drawContext.clearRect(0, 0, canvas.width, canvas.height);
		drawContext.lineJoin = 'round';
		drawContext.lineCap = 'round';
		drawContext.lineWidth = strokeWidthPx;
		drawContext.textBaseline = 'alphabetic';
		drawContext.font = plan.fontDeclaration;

		if (settings.invert) {
			drawContext.fillStyle = '#000000';
			drawRoundedRect(drawContext, 0, 0, canvas.width, canvas.height, Math.max(8, canvas.height * 0.18));
			drawContext.fill();
			drawContext.fillStyle = '#ffffff';
			drawContext.strokeStyle = '#ffffff';
		}
		else {
			drawContext.fillStyle = '#000000';
			drawContext.strokeStyle = '#000000';
		}

		const textX = plan.paddingXPx + plan.leftPx;
		const textY = plan.paddingYPx + plan.ascentPx;
		if (strokeWidthPx > 0) {
			drawContext.strokeText(text, textX, textY);
		}
		drawContext.fillText(text, textX, textY);

		return {
			blob: dataUrlToBlob(canvas.toDataURL('image/png')),
			widthPx: canvas.width,
			heightPx: canvas.height,
			imageWidthMil: plan.imageWidthMil,
			imageHeightMil: plan.imageHeightMil,
		};
	}

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

	async function buildHeaderComponent(component) {
		const pads = asArray(await component.getAllPins());
		if (pads.length < 2) {
			return undefined;
		}

		const designator = getComponentDisplayName(component);
		const componentPadStates = asArray(component.getState_Pads && component.getState_Pads());
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

		const componentLayer = Number(component.getState_Layer && component.getState_Layer()) || PCB_LAYER_TOP;
		const textLayer = componentLayer === PCB_LAYER_BOTTOM ? PCB_LAYER_BOTTOM_SILK : PCB_LAYER_TOP_SILK;
		const axis = getAxis(pads.map((pad) => ({
			x: Number(pad.getState_X && pad.getState_X()) || 0,
			y: Number(pad.getState_Y && pad.getState_Y()) || 0,
		})));

		const padItems = pads.map((pad) => {
			const x = Number(pad.getState_X && pad.getState_X()) || 0;
			const y = Number(pad.getState_Y && pad.getState_Y()) || 0;
			const primitiveId = normalizeText(pad.getState_PrimitiveId && pad.getState_PrimitiveId());
			const padNumber = normalizeText(pad.getState_PadNumber && pad.getState_PadNumber());
			const stateByPrimitiveId = componentPadStateByPrimitiveId.get(primitiveId);
			const stateByPadNumber = componentPadStateByPadNumber.get(padNumber);
			const netName = normalizeText(
				(pad.getState_Net && pad.getState_Net())
				|| (stateByPrimitiveId && stateByPrimitiveId.net)
				|| (stateByPadNumber && stateByPadNumber.net)
				|| '',
			);

			return {
				padNumber,
				netName,
				silkLabel: makeSilkLabel(netName, padNumber),
				x,
				y,
				padShape: pad.getState_Pad && pad.getState_Pad(),
				majorProjection: dot({ x: x - axis.center.x, y: y - axis.center.y }, axis.major),
				minorProjection: dot({ x: x - axis.center.x, y: y - axis.center.y }, axis.minor),
				rowIndex: 0,
			};
		});

		const padExtent = median(padItems.map((item) => getPadExtent(item.padShape)).filter((size) => size > 0));
		const pitch = estimatePitch(padItems.map((item) => item.majorProjection));
		const baseSize = padExtent || pitch || 1.27;
		const rowTolerance = Math.max(baseSize * 0.6, (pitch * 0.35) || 0);
		const rows = clusterRows(padItems, rowTolerance || baseSize * 0.6);
		const recognizedNetCount = padItems.filter((item) => item.netName.length > 0).length;
		const shellBounds = estimateShellBounds(padItems, rows, pitch || baseSize, padExtent || baseSize);

		return {
			componentId: String(component.getState_PrimitiveId && component.getState_PrimitiveId()),
			designator,
			padCount: padItems.length,
			recognizedNetCount,
			componentLayer,
			defaultTextLayer: textLayer,
			textRotation: getTextRotation(axis),
			nominalPitch: pitch || baseSize,
			padExtent: padExtent || baseSize,
			axis,
			shellBounds,
			rows,
			pads: padItems,
		};
	}

	function getRowOffsetSign(row, rows) {
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

	function getPlacementDirection(header, row, settings) {
		switch (settings.positionMode) {
			case 'top':
				return header.axis.minor;
			case 'bottom':
				return { x: -header.axis.minor.x, y: -header.axis.minor.y };
			case 'left':
				return { x: -header.axis.major.x, y: -header.axis.major.y };
			case 'right':
				return header.axis.major;
			default: {
				const sign = getRowOffsetSign(row, header.rows);
				return {
					x: header.axis.minor.x * sign,
					y: header.axis.minor.y * sign,
				};
			}
		}
	}

	function getPlacementRotation(header, settings) {
		if (settings.rotationMode === 'auto') {
			return header.textRotation;
		}
		return Number(settings.rotationMode) || 0;
	}

	function getTargetSilkLayer(header, settings) {
		if (settings.layerMode === 'top') {
			return PCB_LAYER_TOP_SILK;
		}
		if (settings.layerMode === 'bottom') {
			return PCB_LAYER_BOTTOM_SILK;
		}
		return header.defaultTextLayer;
	}

	function getPolygonSourcePoints(polygonSource) {
		const points = [];
		for (let index = 0; index < polygonSource.length; index += 1) {
			if (typeof polygonSource[index] === 'string') {
				continue;
			}
			const x = polygonSource[index];
			const y = polygonSource[index + 1];
			if (typeof x === 'number' && typeof y === 'number') {
				points.push({ x, y });
				index += 1;
			}
		}
		return points;
	}

	function normalizeClosedPoints(points) {
		if (points.length > 2) {
			const firstPoint = points[0];
			const lastPoint = points[points.length - 1];
			if (Math.hypot(firstPoint.x - lastPoint.x, firstPoint.y - lastPoint.y) <= 1e-6) {
				return points.slice(0, -1);
			}
		}
		return points;
	}

	function arePointsWithinTolerance(expected, actual, tolerance) {
		return Math.hypot(expected.x - actual.x, expected.y - actual.y) <= tolerance;
	}

	function matchClosedPolylinePoints(expectedPoints, actualPoints, tolerance) {
		const expected = normalizeClosedPoints(expectedPoints);
		const actual = normalizeClosedPoints(actualPoints);
		if (expected.length !== actual.length || !expected.length) {
			return false;
		}

		for (let offset = 0; offset < actual.length; offset += 1) {
			let sameDirection = true;
			for (let index = 0; index < expected.length; index += 1) {
				if (!arePointsWithinTolerance(expected[index], actual[(index + offset) % actual.length], tolerance)) {
					sameDirection = false;
					break;
				}
			}
			if (sameDirection) {
				return true;
			}

			let reverseDirection = true;
			for (let index = 0; index < expected.length; index += 1) {
				const actualIndex = (offset - index + actual.length) % actual.length;
				if (!arePointsWithinTolerance(expected[index], actual[actualIndex], tolerance)) {
					reverseDirection = false;
					break;
				}
			}
			if (reverseDirection) {
				return true;
			}
		}

		return false;
	}

	function getRangeDistributedCenters(startPoint, endPoint, length) {
		const centers = [];
		if (length <= 0) {
			return centers;
		}

		const xDifferenceAbsolute = Math.abs(startPoint.x - endPoint.x);
		const yDifferenceAbsolute = Math.abs(startPoint.y - endPoint.y);
		if (xDifferenceAbsolute >= yDifferenceAbsolute) {
			const difference = (startPoint.x - endPoint.x) / length;
			for (let index = 0; index < length; index += 1) {
				centers[index] = {
					x: (startPoint.x - difference * index + (startPoint.x - difference * (index + 1))) / 2,
					y: (startPoint.y + endPoint.y) / 2,
				};
			}
			return centers;
		}

		const difference = (startPoint.y - endPoint.y) / length;
		for (let index = 0; index < length; index += 1) {
			centers[index] = {
				x: (startPoint.x + endPoint.x) / 2,
				y: (startPoint.y - difference * index + (startPoint.y - difference * (index + 1))) / 2,
			};
		}
		return centers;
	}

	function getRangeOrientation(startPoint, endPoint) {
		return Math.abs(startPoint.x - endPoint.x) >= Math.abs(startPoint.y - endPoint.y)
			? 'horizontal'
			: 'vertical';
	}

	function getRangeBounds(startPoint, endPoint) {
		return {
			minX: Math.min(startPoint.x, endPoint.x),
			maxX: Math.max(startPoint.x, endPoint.x),
			minY: Math.min(startPoint.y, endPoint.y),
			maxY: Math.max(startPoint.y, endPoint.y),
		};
	}

	function getRangeMinorCenters(startPoint, endPoint, count) {
		if (count <= 0) {
			return [];
		}

		const orientation = getRangeOrientation(startPoint, endPoint);
		if (count === 1) {
			return [orientation === 'horizontal'
				? (startPoint.y + endPoint.y) / 2
				: (startPoint.x + endPoint.x) / 2];
		}

		const bounds = getRangeBounds(startPoint, endPoint);
		const centers = [];
		if (orientation === 'horizontal') {
			const step = (bounds.maxY - bounds.minY) / count;
			for (let index = 0; index < count; index += 1) {
				centers.push(bounds.maxY - step * (index + 0.5));
			}
			return centers;
		}

		const step = (bounds.maxX - bounds.minX) / count;
		for (let index = 0; index < count; index += 1) {
			centers.push(bounds.minX + step * (index + 0.5));
		}
		return centers;
	}

	function getRangePlacementRotation(startPoint, endPoint, settings) {
		if (settings.rotationMode !== 'auto') {
			return Number(settings.rotationMode) || 0;
		}

		return getRangeOrientation(startPoint, endPoint) === 'horizontal' ? 0 : 90;
	}

	function getShellItemsFromRange(startPoint, endPoint, settings) {
		if (!settings.includeShell) {
			return [];
		}

		const bounds = getRangeBounds(startPoint, endPoint);
		const lineWidth = clamp(Math.max(Number(settings.strokeWidthMil) || 0, 4), 4, 40);
		const corners = [
			{ x: bounds.minX, y: bounds.minY },
			{ x: bounds.maxX, y: bounds.minY },
			{ x: bounds.maxX, y: bounds.maxY },
			{ x: bounds.minX, y: bounds.maxY },
		];

		return corners.map((startCorner, index) => {
			const endCorner = corners[(index + 1) % corners.length];
			return {
				type: 'line',
				startX: startCorner.x,
				startY: startCorner.y,
				endX: endCorner.x,
				endY: endCorner.y,
				points: [startCorner, endCorner],
				lineWidth,
			};
		});
	}

	function layoutArtifactsFromRange(artifacts, startPoint, endPoint, settings) {
		const orientation = getRangeOrientation(startPoint, endPoint);
		const rotation = getRangePlacementRotation(startPoint, endPoint, settings);
		const imageItems = artifacts.items.filter(item => item.type === 'image');
		const rowIndexes = [...new Set(imageItems.map(item => item.rowIndex))].sort((a, b) => a - b);
		const minorCenters = getRangeMinorCenters(startPoint, endPoint, rowIndexes.length);
		const rowCenterByIndex = new Map(rowIndexes.map((rowIndex, index) => [rowIndex, minorCenters[index]]));
		const placedItems = [];

		for (const rowIndex of rowIndexes) {
			const rowItems = imageItems
				.filter(item => item.rowIndex === rowIndex)
				.sort((a, b) => a.padIndex - b.padIndex);
			const distributedCenters = getRangeDistributedCenters(startPoint, endPoint, rowItems.length);
			const rowMinorCenter = rowCenterByIndex.get(rowIndex);

			for (let index = 0; index < rowItems.length; index += 1) {
				const item = rowItems[index];
				const distributedCenter = distributedCenters[index];
				const centerX = orientation === 'horizontal' ? distributedCenter.x : rowMinorCenter;
				const centerY = orientation === 'horizontal' ? rowMinorCenter : distributedCenter.y;
				const topLeft = getImageTopLeftFromCenter(
					centerX,
					centerY,
					item.imageWidth,
					item.imageHeight,
					rotation,
				);

				placedItems.push({
					...item,
					centerX,
					centerY,
					topLeftX: topLeft.x,
					topLeftY: topLeft.y,
					rotation,
				});
			}
		}

		return placedItems.concat(getShellItemsFromRange(startPoint, endPoint, settings));
	}

	function getHeaderShellItems(header, settings) {
		if (!settings.includeShell) {
			return [];
		}

		const lineWidth = clamp(Math.max(Number(settings.strokeWidthMil) || 0, 4), 4, 40);
		const bounds = header.shellBounds;
		const corners = [
			projectPoint(header.axis, bounds.majorMin, bounds.minorMin),
			projectPoint(header.axis, bounds.majorMax, bounds.minorMin),
			projectPoint(header.axis, bounds.majorMax, bounds.minorMax),
			projectPoint(header.axis, bounds.majorMin, bounds.minorMax),
		];
		return corners.map((startPoint, index) => {
			const endPoint = corners[(index + 1) % corners.length];
			return {
				type: 'line',
				startX: startPoint.x,
				startY: startPoint.y,
				endX: endPoint.x,
				endY: endPoint.y,
				points: [startPoint, endPoint],
				lineWidth,
			};
		});
	}

	async function buildHeaderArtifacts(header, settings) {
		const targetLayer = getTargetSilkLayer(header, settings);
		const artifacts = [];
		const assetCache = new Map();
		const offsetMil = clamp(Number(settings.offsetMil) || 18, 1, 300);
		const rotation = getPlacementRotation(header, settings);
		for (const row of header.rows) {
			const direction = getPlacementDirection(header, row, settings);
			for (let padIndex = 0; padIndex < row.pads.length; padIndex += 1) {
				const pad = row.pads[padIndex];
				if (!pad.silkLabel) {
					continue;
				}

				const placement = {
					text: pad.silkLabel,
					x: pad.x + direction.x * offsetMil,
					y: pad.y + direction.y * offsetMil,
					rotation,
				};

				if (!assetCache.has(placement.text)) {
					assetCache.set(placement.text, (async () => {
						const rendered = await renderTextToBlob(placement.text, settings);
						const complexPolygon = await eda.pcb_MathPolygon.convertImageToComplexPolygon(
							rendered.blob,
							rendered.widthPx,
							rendered.heightPx,
							0.3,
							0.9,
							1,
							2,
							false,
							false,
						);

						if (!complexPolygon) {
							throw new Error('生成失败，请调整参数后重试。');
						}

						return {
							complexPolygon,
							imageWidth: rendered.imageWidthMil,
							imageHeight: rendered.imageHeightMil,
						};
					})());
				}

				const asset = await assetCache.get(placement.text);
				const topLeft = getImageTopLeftFromCenter(
					placement.x,
					placement.y,
					asset.imageWidth,
					asset.imageHeight,
					placement.rotation,
				);

				artifacts.push({
					type: 'image',
					text: placement.text,
					rowIndex: row.index,
					padIndex,
					centerX: placement.x,
					centerY: placement.y,
					topLeftX: topLeft.x,
					topLeftY: topLeft.y,
					imageWidth: asset.imageWidth,
					imageHeight: asset.imageHeight,
					horizonMirror: false,
					rotation: placement.rotation,
					complexPolygon: asset.complexPolygon,
				});
			}
		}

		return {
			layer: targetLayer,
			header,
			items: artifacts.concat(getHeaderShellItems(header, settings)),
		};
	}

	function waitForRangeSelection() {
		return new Promise((resolve, reject) => {
			const followMouseTip = '请在 PCB 画布上框选生成范围。';
			const rangePoints = [];
			let finished = false;

			function cleanup() {
				try {
					eda.pcb_Event.removeEventListener(RANGE_SELECTION_EVENT_ID);
				}
				catch {}

				void eda.sys_Message.removeFollowMouseTip(followMouseTip).catch(() => {});
			}

			if (eda.pcb_Event.isEventListenerAlreadyExist(RANGE_SELECTION_EVENT_ID)) {
				eda.pcb_Event.removeEventListener(RANGE_SELECTION_EVENT_ID);
			}

			void eda.sys_Message.showFollowMouseTip(followMouseTip).catch(() => {});
			eda.sys_Message.showToastMessage('请在 PCB 中框选生成范围。', ESYS_ToastMessageType.INFO, 3);

			eda.pcb_Event.addMouseEventListener(RANGE_SELECTION_EVENT_ID, 'selected', async () => {
				if (finished) {
					return;
				}

				try {
					const currentMousePosition = await eda.pcb_SelectControl.getCurrentMousePosition();
					if (!currentMousePosition) {
						return;
					}

					rangePoints.push({
						x: Number(currentMousePosition.x) || 0,
						y: Number(currentMousePosition.y) || 0,
					});

					if (rangePoints.length < 2) {
						return;
					}

					const startPoint = rangePoints[0];
					const endPoint = rangePoints[1];
					if (Math.hypot(startPoint.x - endPoint.x, startPoint.y - endPoint.y) < MIN_RANGE_SELECTION_DISTANCE) {
						rangePoints.length = 0;
						eda.sys_Message.showToastMessage('请拖动框选一个范围，不要单击。', ESYS_ToastMessageType.WARNING, 3);
						return;
					}

					finished = true;
					cleanup();
					resolve({
						startPoint,
						endPoint,
					});
				}
				catch (error) {
					finished = true;
					cleanup();
					reject(error);
				}
			}, false);
		});
	}

	async function createCombinedSilkAtMouse(artifacts, settings) {
		const selection = await waitForRangeSelection();
		const translatedItems = layoutArtifactsFromRange(artifacts, selection.startPoint, selection.endPoint, settings);
		const finalHandles = await createFinalGroup(artifacts.layer, translatedItems, false);
		if (!finalHandles.length) {
			throw new Error('生成失败，请重试。');
		}

		try {
			const totalCreated = await finalizePlacedGroup(artifacts.layer, translatedItems, finalHandles);
			return {
				totalCreated,
				handles: finalHandles,
			};
		}
		catch (error) {
			await deleteFinalGroup(finalHandles).catch(() => {});
			throw error;
		}
	}

	async function createFinalGroup(layer, items, primitiveLock) {
		const handles = [];
		for (const item of items) {
			if (item.type === 'image') {
				const createdImage = await eda.pcb_PrimitiveImage.create(
					item.topLeftX,
					item.topLeftY,
					item.complexPolygon,
					layer,
					item.imageWidth,
					item.imageHeight,
					item.rotation,
					item.horizonMirror,
					Boolean(primitiveLock),
				);
				if (createdImage) {
					handles.push({ type: 'image', primitive: createdImage });
				}
				continue;
			}

			const createdLine = await eda.pcb_PrimitiveLine.create(
				'',
				layer,
				item.startX,
				item.startY,
				item.endX,
				item.endY,
				item.lineWidth,
				Boolean(primitiveLock),
			);
			if (createdLine) {
				handles.push({ type: 'line', primitive: createdLine });
			}
		}
		return handles;
	}

	async function deleteFinalGroup(handles) {
		if (!handles.length) {
			return;
		}
		const images = handles.filter((handle) => handle.type === 'image').map((handle) => handle.primitive);
		const lines = handles.filter((handle) => handle.type === 'line').map((handle) => handle.primitive);
		if (images.length) {
			await eda.pcb_PrimitiveImage.delete(images);
		}
		if (lines.length) {
			await eda.pcb_PrimitiveLine.delete(lines);
		}
	}

	function getExcludedPrimitiveIds(handles) {
		return new Set(
			handles
				.map((handle) => handle && handle.primitive && handle.primitive.getState_PrimitiveId && handle.primitive.getState_PrimitiveId())
				.filter(Boolean),
		);
	}

	async function deleteExistingArtifacts(layer, items, excludedPrimitiveIds) {
		const imageItems = items.filter((item) => item.type === 'image');
		const lineItems = items.filter((item) => item.type === 'line');
		let deletedCount = 0;

		if (imageItems.length) {
			const existingImages = asArray(await eda.pcb_PrimitiveImage.getAll(layer));
			const imagesToDelete = [];
			for (const existingImage of existingImages) {
				const primitiveId = existingImage.getState_PrimitiveId && existingImage.getState_PrimitiveId();
				if (excludedPrimitiveIds && primitiveId && excludedPrimitiveIds.has(primitiveId)) {
					continue;
				}
				const existingX = Number(existingImage.getState_X && existingImage.getState_X());
				const existingY = Number(existingImage.getState_Y && existingImage.getState_Y());
				const existingWidth = Number(existingImage.getState_Width && existingImage.getState_Width());
				const existingHeight = Number(existingImage.getState_Height && existingImage.getState_Height());
				const existingRotation = Number(existingImage.getState_Rotation && existingImage.getState_Rotation());

				const matchedItem = imageItems.find((item) => {
					if (Math.abs(existingRotation - item.rotation) > 1) {
						return false;
					}
					const tolerance = Math.max(Math.min(item.imageWidth, item.imageHeight) * 0.2, 1);
					if (Math.abs(existingWidth - item.imageWidth) > tolerance) {
						return false;
					}
					if (Math.abs(existingHeight - item.imageHeight) > tolerance) {
						return false;
					}
					return Math.hypot(existingX - item.topLeftX, existingY - item.topLeftY) <= tolerance;
				});

				if (matchedItem) {
					imagesToDelete.push(existingImage);
				}
			}

			if (imagesToDelete.length) {
				await eda.pcb_PrimitiveImage.delete(imagesToDelete);
				deletedCount += imagesToDelete.length;
			}
		}

		if (lineItems.length) {
			const existingLines = asArray(await eda.pcb_PrimitiveLine.getAll(undefined, layer));
			const linesToDelete = [];
			for (const existingLine of existingLines) {
				const primitiveId = existingLine.getState_PrimitiveId && existingLine.getState_PrimitiveId();
				if (excludedPrimitiveIds && primitiveId && excludedPrimitiveIds.has(primitiveId)) {
					continue;
				}
				const matchedItem = lineItems.find((item) => {
					const tolerance = Math.max(item.lineWidth * 0.5, 1);
					const sameDirection = Math.hypot(existingLine.getState_StartX() - item.startX, existingLine.getState_StartY() - item.startY) <= tolerance
						&& Math.hypot(existingLine.getState_EndX() - item.endX, existingLine.getState_EndY() - item.endY) <= tolerance;
					const reverseDirection = Math.hypot(existingLine.getState_StartX() - item.endX, existingLine.getState_StartY() - item.endY) <= tolerance
						&& Math.hypot(existingLine.getState_EndX() - item.startX, existingLine.getState_EndY() - item.startY) <= tolerance;
					return (sameDirection || reverseDirection)
						&& Math.abs(existingLine.getState_LineWidth() - item.lineWidth) <= tolerance;
				});

				if (matchedItem) {
					linesToDelete.push(existingLine);
				}
			}

			if (linesToDelete.length) {
				await eda.pcb_PrimitiveLine.delete(linesToDelete);
				deletedCount += linesToDelete.length;
			}
		}

		return deletedCount;
	}

	async function finalizePlacedGroup(layer, items, handles) {
		await deleteExistingArtifacts(layer, items, getExcludedPrimitiveIds(handles));
		return handles.length;
	}

	async function resolveSelectedHeader() {
		const components = await getSelectedComponents();
		const headers = (await Promise.all(components.map(buildHeaderComponent))).filter(Boolean);
		if (!components.length) {
			throw new Error('请先选中一个排针。');
		}
		if (!headers.length) {
			throw new Error('未找到可用的焊盘。');
		}
		if (headers.length > 1) {
			throw new Error('请只选择一个排针。');
		}
		return headers[0];
	}

	async function startPlacement() {
		syncSettingsFromForm();

		try {
			const placementSettings = { ...currentSettings };
			const header = await resolveSelectedHeader();
			const artifacts = await buildHeaderArtifacts(header, placementSettings);
			if (!artifacts.items.length) {
				eda.sys_Message.showToastMessage('没有可生成的丝印。', ESYS_ToastMessageType.WARNING, 3);
				return;
			}

			const result = await createCombinedSilkAtMouse(artifacts, placementSettings);
			eda.sys_Message.showToastMessage(`已按框选范围生成，共 ${result.totalCreated} 个图元。`, ESYS_ToastMessageType.SUCCESS, 2);
			void eda.pcb_SelectControl.clearSelected().catch(() => {});
		}
		catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			eda.sys_Message.showToastMessage(message, ESYS_ToastMessageType.ERROR, 4);
		}
	}

	function bindSettings() {
		elements.fontFamily.addEventListener('change', () => {
			currentSettings.fontFamily = elements.fontFamily.value || DEFAULT_SETTINGS.fontFamily;
			saveSettings(currentSettings);
			renderPreview();
		});

		elements.unitMode.addEventListener('change', () => {
			syncSettingsFromForm();
			currentSettings.unitMode = elements.unitMode.value === 'mm' ? 'mm' : 'mil';
			saveSettings(currentSettings);
			applySettings(currentSettings);
		});

		elements.layerMode.addEventListener('change', () => {
			currentSettings.layerMode = elements.layerMode.value || DEFAULT_SETTINGS.layerMode;
			saveSettings(currentSettings);
			renderPreview();
		});

		elements.fontSize.addEventListener('input', () => {
			currentSettings.fontSizeMil = clamp(fromDisplayValue(Number(elements.fontSize.value) || 0, currentSettings.unitMode), 10, 240);
			saveSettings(currentSettings);
			renderPreview();
		});

		elements.strokeWidth.addEventListener('input', () => {
			currentSettings.strokeWidthMil = clamp(fromDisplayValue(Number(elements.strokeWidth.value) || 0, currentSettings.unitMode), 0, 80);
			saveSettings(currentSettings);
			renderPreview();
		});

		elements.positionMode.addEventListener('change', () => {
			currentSettings.positionMode = elements.positionMode.value || DEFAULT_SETTINGS.positionMode;
			saveSettings(currentSettings);
			renderPreview();
		});

		elements.rotationMode.addEventListener('change', () => {
			currentSettings.rotationMode = elements.rotationMode.value || DEFAULT_SETTINGS.rotationMode;
			saveSettings(currentSettings);
			renderPreview();
		});

		elements.offset.addEventListener('input', () => {
			currentSettings.offsetMil = clamp(fromDisplayValue(Number(elements.offset.value) || 0, currentSettings.unitMode), 1, 300);
			saveSettings(currentSettings);
			renderPreview();
		});

		elements.includeShell.addEventListener('change', () => {
			currentSettings.includeShell = elements.includeShell.checked;
			saveSettings(currentSettings);
			renderPreview();
		});

		elements.invert.addEventListener('change', () => {
			currentSettings.invert = elements.invert.checked;
			saveSettings(currentSettings);
			renderPreview();
		});

		elements.reset.addEventListener('click', () => {
			currentSettings = { ...DEFAULT_SETTINGS };
			saveSettings(currentSettings);
			applySettings(currentSettings);
		});

		elements.generate.addEventListener('click', () => {
			void startPlacement();
		});
	}

	window.addEventListener('DOMContentLoaded', async () => {
		await populateFontOptions(currentSettings);
		applySettings(currentSettings);
		bindSettings();
	});
})();
