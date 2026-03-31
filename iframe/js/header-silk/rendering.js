import {
	DEFAULT_SETTINGS,
	PREVIEW_BASE_IMAGE_HEIGHT_PX,
	TEXT_RENDER_FONT_PX,
	TEXT_RENDER_FONT_WEIGHT,
	TEXT_RENDER_PADDING_X_PX,
	TEXT_RENDER_PADDING_Y_PX,
	appState,
	applyLabelMappingWithMap,
	clamp,
	formatNumeric,
	parseLabelMappings,
	toDisplayValue,
} from './shared.js';

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

	function getTextRenderSettings(settings) {
		const fontSizeMil = Math.max(Number(settings && settings.fontSizeMil) || 1, 1);
		const strokeWidthMil = clamp(Number(settings && settings.strokeWidthMil) || 0, 0, fontSizeMil * 0.38);
		const marginXMil = clamp(fontSizeMil * 0.05 + strokeWidthMil * 0.45, 1.6, 5.5);
		const marginYMil = clamp(fontSizeMil * 0.075 + strokeWidthMil * 0.55, 2, 7);
		return {
			fontSizeMil,
			strokeWidthMil,
			marginXMil,
			marginYMil,
		};
	}

	function getPreviewImageHeightPx(settings) {
		const { fontSizeMil } = getTextRenderSettings(settings);
		const scale = clamp(fontSizeMil / DEFAULT_SETTINGS.fontSizeMil, 0.45, 2.4);
		return clamp(PREVIEW_BASE_IMAGE_HEIGHT_PX * scale, 14, 72);
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
		context.font = `${TEXT_RENDER_FONT_WEIGHT} ${fontPx}px "${settings.fontFamily}", sans-serif`;
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
		const labelMappings = parseLabelMappings(appState.currentSettings.labelMapText);
		const labels = ['3V3', 'SCL', 'TX', 'RX', 'GND'].map(label => applyLabelMappingWithMap(label, labelMappings));
		const orientation = appState.currentSettings.positionMode === 'left' || appState.currentSettings.positionMode === 'right'
			? 'vertical'
			: 'horizontal';
		const previewRotation = getPreviewRotation(appState.currentSettings, orientation);
		const textMetrics = getTextSourceMetrics(appState.currentSettings);
		const previewImageHeightPx = getPreviewImageHeightPx(appState.currentSettings);
		const previewStrokePx = textMetrics.strokeWidthPx <= 0
			? 0
			: Math.max((previewImageHeightPx / Math.max(textMetrics.canvasHeightPx, 1)) * textMetrics.strokeWidthPx, 0.5);
		const offsetPx = clamp(appState.currentSettings.offsetMil * 0.55, 14, 56);

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

		if (appState.currentSettings.includeShell) {
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
		switch (appState.currentSettings.positionMode) {
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

			drawPreviewLabel(context, labels[index], labelX, labelY, previewRotation, appState.currentSettings, previewImageHeightPx, textMetrics);
		}

		const fontSizeDisplay = formatNumeric(toDisplayValue(appState.currentSettings.fontSizeMil, appState.currentSettings.unitMode));
		const strokeDisplay = formatNumeric(toDisplayValue(appState.currentSettings.strokeWidthMil, appState.currentSettings.unitMode));
		const offsetDisplay = formatNumeric(toDisplayValue(appState.currentSettings.offsetMil, appState.currentSettings.unitMode));
		const shellText = appState.currentSettings.includeShell ? '，含外框' : '';
		const mappingCount = labelMappings.size;
		const mappingText = mappingCount > 0 ? `，映射 ${mappingCount} 项` : '';
		const layerText = appState.currentSettings.layerMode === 'top'
			? '顶层'
			: appState.currentSettings.layerMode === 'bottom'
				? '底层'
				: '自动';
		summary.textContent = `字号 ${fontSizeDisplay} ${appState.currentSettings.unitMode}，粗细 ${strokeDisplay} ${appState.currentSettings.unitMode}，偏移 ${offsetDisplay} ${appState.currentSettings.unitMode}，${layerText}${shellText}${mappingText}，密集区域自动微缩。`;
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

export {
	dataUrlToBlob,
	drawRoundedRect,
	getImageCenterFromTopLeft,
	getImageTopLeftFromCenter,
	getTextRenderPlan,
	getTextRenderSettings,
	getTextSourceMetrics,
	renderPreview,
	renderTextToBlob,
};

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

	function getImageCenterFromTopLeft(topLeftX, topLeftY, width, height, rotation) {
		const normalizedRotation = ((Math.round(rotation) % 360) + 360) % 360;
		switch (normalizedRotation) {
			case 0:
				return { x: topLeftX + width / 2, y: topLeftY - height / 2 };
			case 90:
				return { x: topLeftX + height / 2, y: topLeftY + width / 2 };
			case 180:
				return { x: topLeftX - width / 2, y: topLeftY + height / 2 };
			case 270:
				return { x: topLeftX - height / 2, y: topLeftY - width / 2 };
			default:
				return { x: topLeftX + width / 2, y: topLeftY - height / 2 };
		}
	}

	function getTextSourceMetrics(settings) {
		const textSettings = getTextRenderSettings(settings);
		const baseHeightPx = Math.ceil(TEXT_RENDER_FONT_PX * 1.04) + TEXT_RENDER_PADDING_Y_PX * 2;
		const pxPerMil = baseHeightPx / textSettings.fontSizeMil;
		const strokeWidthPx = textSettings.strokeWidthMil * pxPerMil;
		const canvasHeightPx = baseHeightPx + strokeWidthPx * 2;
		const imageScale = textSettings.fontSizeMil / canvasHeightPx;
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

		const textSettings = getTextRenderSettings(settings);
		const fontDeclaration = `${TEXT_RENDER_FONT_WEIGHT} ${TEXT_RENDER_FONT_PX}px "${settings.fontFamily}", sans-serif`;
		measureContext.font = fontDeclaration;
		measureContext.textBaseline = 'alphabetic';

		const measured = measureContext.measureText(text);
		const ascentPx = Math.max(measured.actualBoundingBoxAscent || TEXT_RENDER_FONT_PX * 0.78, 1);
		const descentPx = Math.max(measured.actualBoundingBoxDescent || TEXT_RENDER_FONT_PX * 0.22, 1);
		const leftPx = Math.max(measured.actualBoundingBoxLeft || 0, 0);
		const rightPx = Math.max(measured.actualBoundingBoxRight || measured.width || TEXT_RENDER_FONT_PX * 0.6, 1);
		const fillWidthPx = Math.max(leftPx + rightPx, 1);
		const fillHeightPx = Math.max(ascentPx + descentPx, 1);
		const pxPerMil = fillHeightPx / textSettings.fontSizeMil;
		const strokeWidthPx = textSettings.strokeWidthMil * pxPerMil;
		const marginXPx = textSettings.marginXMil * pxPerMil;
		const marginYPx = textSettings.marginYMil * pxPerMil;
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

	async function renderTextToBlob(text, settings, plan) {
		const renderPlan = plan || getTextRenderPlan(text, settings);
		const strokeWidthPx = renderPlan.strokeWidthPx;

		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('生成失败，请重试。');
		}

		canvas.width = renderPlan.canvasWidthPx;
		canvas.height = renderPlan.canvasHeightPx;

		const drawContext = canvas.getContext('2d');
		if (!drawContext) {
			throw new Error('生成失败，请重试。');
		}

		drawContext.clearRect(0, 0, canvas.width, canvas.height);
		drawContext.lineJoin = 'round';
		drawContext.lineCap = 'round';
		drawContext.lineWidth = strokeWidthPx;
		drawContext.textBaseline = 'alphabetic';
		drawContext.font = renderPlan.fontDeclaration;

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

		const textX = renderPlan.paddingXPx + renderPlan.leftPx;
		const textY = renderPlan.paddingYPx + renderPlan.ascentPx;
		if (strokeWidthPx > 0) {
			drawContext.strokeText(text, textX, textY);
		}
		drawContext.fillText(text, textX, textY);

		return {
			blob: dataUrlToBlob(canvas.toDataURL('image/png')),
			widthPx: canvas.width,
			heightPx: canvas.height,
			imageWidthMil: renderPlan.imageWidthMil,
			imageHeightMil: renderPlan.imageHeightMil,
		};
	}
