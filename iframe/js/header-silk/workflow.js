import {
	AUTO_SHRINK_EASE,
	AUTO_SHRINK_GAP_RATIO_MAJOR,
	AUTO_SHRINK_GAP_RATIO_MINOR,
	CREATE_BATCH_SIZE,
	MAX_TEXT_ASSET_CACHE,
	MIN_AUTO_SHRINK_SCALE,
	MIN_RANGE_SELECTION_DISTANCE,
	PCB_LAYER_BOTTOM_SILK,
	PCB_LAYER_TOP_SILK,
	RANGE_SELECTION_EVENT_ID,
	appState,
	asArray,
	clamp,
	deleteArtifactGroupByRecord,
	doesArtifactGroupMatchHeader,
	getCurrentDocumentScope,
	loadArtifactGroups,
	normalizeText,
	parseLabelMappings,
	projectPoint,
	rememberGeneratedArtifacts,
	resolveHeaderPadDisplayLabel,
	saveArtifactGroups,
	textAssetCache,
	touchMapEntry,
	trimMapSize,
} from './shared.js';
import { buildHeaderComponent, getSelectedComponents } from './header.js';
import {
	getImageCenterFromTopLeft,
	getImageTopLeftFromCenter,
	getTextRenderPlan,
	getTextRenderSettings,
	renderTextToBlob,
} from './rendering.js';

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

	function comparePadNumbers(leftPadNumber, rightPadNumber) {
		return String(leftPadNumber || '').localeCompare(String(rightPadNumber || ''), 'en', {
			numeric: true,
			sensitivity: 'base',
		});
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
		const lineWidth = clamp(Math.max(Number(settings.strokeWidthMil) || 0, 1), 1, 40);
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

	function getOrientedImageSize(imageWidth, imageHeight, rotation) {
		const normalizedRotation = ((Math.round(rotation) % 360) + 360) % 360;
		if (normalizedRotation === 90 || normalizedRotation === 270) {
			return {
				width: imageHeight,
				height: imageWidth,
			};
		}

		return {
			width: imageWidth,
			height: imageHeight,
		};
	}

	function getItemAxisFootprint(item, orientation, rotation) {
		const orientedSize = getOrientedImageSize(item.imageWidth, item.imageHeight, rotation);
		return orientation === 'horizontal'
			? {
				major: orientedSize.width,
				minor: orientedSize.height,
			}
			: {
				major: orientedSize.height,
				minor: orientedSize.width,
			};
	}

	function getAutoShrinkScaleForItem(item, placementContext) {
		if (!placementContext || !Number.isFinite(placementContext.majorStep) || placementContext.majorStep <= 0) {
			return 1;
		}

		const footprint = getItemAxisFootprint(item, placementContext.orientation, placementContext.rotation);
		const availableMajor = placementContext.majorStep * AUTO_SHRINK_GAP_RATIO_MAJOR;
		const availableMinor = placementContext.rowCount > 1
			? placementContext.minorStep * AUTO_SHRINK_GAP_RATIO_MINOR
			: Number.POSITIVE_INFINITY;
		const scaleByMajor = footprint.major > 0 ? availableMajor / footprint.major : 1;
		const scaleByMinor = footprint.minor > 0 ? availableMinor / footprint.minor : 1;
		const fitScale = Math.min(scaleByMajor, scaleByMinor, 1);
		if (fitScale >= 1) {
			return 1;
		}
		const easedScale = 1 - (1 - fitScale) * AUTO_SHRINK_EASE;
		return clamp(easedScale, MIN_AUTO_SHRINK_SCALE, 1);
	}

	function layoutArtifactsFromRange(artifacts, startPoint, endPoint, settings) {
		const orientation = getRangeOrientation(startPoint, endPoint);
		const rotation = getRangePlacementRotation(startPoint, endPoint, settings);
		const imageItems = artifacts.items.filter(item => item.type === 'image');
		const rowIndexes = [...new Set(imageItems.map(item => item.rowIndex))].sort((a, b) => a - b);
		const minorCenters = getRangeMinorCenters(startPoint, endPoint, rowIndexes.length);
		const rowCenterByIndex = new Map(rowIndexes.map((rowIndex, index) => [rowIndex, minorCenters[index]]));
		const bounds = getRangeBounds(startPoint, endPoint);
		const majorSpan = orientation === 'horizontal'
			? Math.max(bounds.maxX - bounds.minX, 0)
			: Math.max(bounds.maxY - bounds.minY, 0);
		const minorSpan = orientation === 'horizontal'
			? Math.max(bounds.maxY - bounds.minY, 0)
			: Math.max(bounds.maxX - bounds.minX, 0);
		const maxItemsPerRow = Math.max(...rowIndexes.map((rowIndex) => imageItems.filter(item => item.rowIndex === rowIndex).length), 1);
		const placementContext = {
			orientation,
			rotation,
			rowCount: Math.max(rowIndexes.length, 1),
			majorStep: maxItemsPerRow > 0 ? majorSpan / maxItemsPerRow : majorSpan,
			minorStep: rowIndexes.length > 0 ? minorSpan / rowIndexes.length : minorSpan,
		};
		const placedItems = [];

		for (const rowIndex of rowIndexes) {
			const rowItems = imageItems
				.filter(item => item.rowIndex === rowIndex)
				.sort((a, b) => {
					const padNumberOrder = comparePadNumbers(a.padNumber, b.padNumber);
					if (padNumberOrder !== 0) {
						return padNumberOrder;
					}
					return a.padIndex - b.padIndex;
				});
			const distributedCenters = getRangeDistributedCenters(startPoint, endPoint, rowItems.length);
			const rowMinorCenter = rowCenterByIndex.get(rowIndex);

			for (let index = 0; index < rowItems.length; index += 1) {
				const item = rowItems[index];
				const distributedCenter = distributedCenters[index];
				const centerX = orientation === 'horizontal' ? distributedCenter.x : rowMinorCenter;
				const centerY = orientation === 'horizontal' ? rowMinorCenter : distributedCenter.y;
				const autoScale = getAutoShrinkScaleForItem(item, placementContext);
				const scaledImageWidth = item.imageWidth * autoScale;
				const scaledImageHeight = item.imageHeight * autoScale;
				const topLeft = getImageTopLeftFromCenter(
					centerX,
					centerY,
					scaledImageWidth,
					scaledImageHeight,
					rotation,
				);

				placedItems.push({
					...item,
					centerX,
					centerY,
					topLeftX: topLeft.x,
					topLeftY: topLeft.y,
					imageWidth: scaledImageWidth,
					imageHeight: scaledImageHeight,
					rotation,
					autoScale,
				});
			}
		}

		return placedItems.concat(getShellItemsFromRange(startPoint, endPoint, settings));
	}

	function getDeleteTargetLayers(header, settings) {
		const layers = new Set([header.defaultTextLayer]);
		if (settings.layerMode === 'top') {
			layers.add(PCB_LAYER_TOP_SILK);
		}
		else if (settings.layerMode === 'bottom') {
			layers.add(PCB_LAYER_BOTTOM_SILK);
		}
		return Array.from(layers);
	}

	function getDeletionTargetsFromRange(header, startPoint, endPoint) {
		const orientation = getRangeOrientation(startPoint, endPoint);
		const rowIndexes = [...new Set(header.rows.map(row => row.index))].sort((a, b) => a - b);
		const rowPads = rowIndexes.map((rowIndex) => {
			const row = header.rows.find(item => item.index === rowIndex);
			const pads = row
				? [...row.pads].sort((leftPad, rightPad) => {
					const padNumberOrder = comparePadNumbers(leftPad.padNumber, rightPad.padNumber);
					if (padNumberOrder !== 0) {
						return padNumberOrder;
					}
					return leftPad.majorProjection - rightPad.majorProjection;
				})
				: [];
			return {
				rowIndex,
				pads,
			};
		});
		const rowCount = rowPads.length || 1;
		const minorCenters = getRangeMinorCenters(startPoint, endPoint, rowCount);
		const rowCenterByIndex = new Map(rowIndexes.map((rowIndex, index) => [rowIndex, minorCenters[index]]));
		const targets = [];

		for (const rowItem of rowPads) {
			const distributedCenters = getRangeDistributedCenters(startPoint, endPoint, rowItem.pads.length);
			const rowMinorCenter = rowCenterByIndex.get(rowItem.rowIndex);

			for (let index = 0; index < rowItem.pads.length; index += 1) {
				const distributedCenter = distributedCenters[index];
				targets.push({
					rowIndex: rowItem.rowIndex,
					padNumber: rowItem.pads[index].padNumber,
					centerX: orientation === 'horizontal' ? distributedCenter.x : rowMinorCenter,
					centerY: orientation === 'horizontal' ? rowMinorCenter : distributedCenter.y,
				});
			}
		}

		const bounds = getRangeBounds(startPoint, endPoint);
		const majorSpan = orientation === 'horizontal' ? bounds.maxX - bounds.minX : bounds.maxY - bounds.minY;
		const minorSpan = orientation === 'horizontal' ? bounds.maxY - bounds.minY : bounds.maxX - bounds.minX;
		const maxItemsInRow = Math.max(...rowPads.map(rowItem => rowItem.pads.length), 1);
		const longitudinalTolerance = clamp((majorSpan / Math.max(maxItemsInRow, 1)) * 0.38, 8, 28);
		const crossTolerance = rowCount > 1
			? clamp((minorSpan / rowCount) * 0.42, 8, 28)
			: clamp(header.nominalPitch * 0.45, 8, 24);
		const tolerance = Math.max(longitudinalTolerance, crossTolerance);

		return {
			targets,
			shellItems: getShellItemsFromRange(startPoint, endPoint, {
				includeShell: true,
				strokeWidthMil: Math.max(header.nominalPitch * 0.18, 4),
			}),
			tolerance,
		};
	}

	function getHeaderShellItems(header, settings) {
		if (!settings.includeShell) {
			return [];
		}

		const lineWidth = clamp(Math.max(Number(settings.strokeWidthMil) || 0, 1), 1, 40);
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
		const textPlanCache = new Map();
		const labelMappings = parseLabelMappings(settings && settings.labelMapText);
		const offsetMil = clamp(Number(settings.offsetMil) || 18, 1, 300);
		const rotation = getPlacementRotation(header, settings);
		for (const row of header.rows) {
			const direction = getPlacementDirection(header, row, settings);
			for (let padIndex = 0; padIndex < row.pads.length; padIndex += 1) {
				const pad = row.pads[padIndex];
				const displayLabel = resolveHeaderPadDisplayLabel(header, pad, labelMappings).displayLabel;
				if (!displayLabel) {
					continue;
				}

				const placement = {
					text: displayLabel,
					x: pad.x + direction.x * offsetMil,
					y: pad.y + direction.y * offsetMil,
					rotation,
				};

				if (!textPlanCache.has(placement.text)) {
					textPlanCache.set(placement.text, getTextRenderPlan(placement.text, settings));
				}

				const textPlan = textPlanCache.get(placement.text);
				const topLeft = getImageTopLeftFromCenter(
					placement.x,
					placement.y,
					textPlan.imageWidthMil,
					textPlan.imageHeightMil,
					placement.rotation,
				);

				artifacts.push({
					type: 'image',
					text: placement.text,
					padNumber: pad.padNumber,
					rowIndex: row.index,
					padIndex,
					centerX: placement.x,
					centerY: placement.y,
					topLeftX: topLeft.x,
					topLeftY: topLeft.y,
					imageWidth: textPlan.imageWidthMil,
					imageHeight: textPlan.imageHeightMil,
					horizonMirror: false,
					rotation: placement.rotation,
				});
			}
		}

		return {
			layer: targetLayer,
			header,
			items: artifacts.concat(getHeaderShellItems(header, settings)),
		};
	}

	async function prepareTextComplexPolygon(text, settings) {
		const plan = getTextRenderPlan(text, settings);
		const rendered = await renderTextToBlob(text, settings, plan);
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

		return complexPolygon;
	}

	function createTextAssetCacheKey(text, settings) {
		const textSettings = getTextRenderSettings(settings);
		const fontFamily = normalizeText(settings && settings.fontFamily) || DEFAULT_SETTINGS.fontFamily;
		return [
			text,
			fontFamily,
			textSettings.fontSizeMil.toFixed(3),
			textSettings.strokeWidthMil.toFixed(3),
			settings && settings.invert ? 'invert' : 'normal',
		].join('|');
	}

	async function getOrPrepareTextComplexPolygon(text, settings) {
		const cacheKey = createTextAssetCacheKey(text, settings);
		const cachedEntry = textAssetCache.get(cacheKey);
		if (cachedEntry) {
			touchMapEntry(textAssetCache, cacheKey, cachedEntry);
			return cachedEntry;
		}

		const pendingEntry = prepareTextComplexPolygon(text, settings)
			.then((complexPolygon) => {
				touchMapEntry(textAssetCache, cacheKey, Promise.resolve(complexPolygon));
				trimMapSize(textAssetCache, MAX_TEXT_ASSET_CACHE, cacheKey);
				return complexPolygon;
			})
			.catch((error) => {
				textAssetCache.delete(cacheKey);
				throw error;
			});

		touchMapEntry(textAssetCache, cacheKey, pendingEntry);
		trimMapSize(textAssetCache, MAX_TEXT_ASSET_CACHE, cacheKey);
		return pendingEntry;
	}

	async function prepareTextAssetMap(items, settings) {
		const imageItems = items.filter(item => item.type === 'image');
		if (!imageItems.length) {
			return new Map();
		}

		const uniqueTexts = [...new Set(imageItems.map(item => item.text).filter(Boolean))];
		const assetEntries = await Promise.all(uniqueTexts.map(async (text) => {
			const complexPolygon = await getOrPrepareTextComplexPolygon(text, settings);
			return [text, complexPolygon];
		}));
		return new Map(assetEntries);
	}

	function hydratePlacedItemsWithAssetMap(items, assetMap) {
		return items.map((item) => {
			if (item.type !== 'image') {
				return item;
			}

			return {
				...item,
				complexPolygon: assetMap.get(item.text),
			};
		});
	}

	function waitForRangeSelection(options) {
		return new Promise((resolve, reject) => {
			const selectionOptions = options || {};
			const followMouseTip = selectionOptions.followMouseTip || '请在 PCB 画布上框选生成范围。';
			const toastMessage = selectionOptions.toastMessage || '请在 PCB 中框选生成范围。';
			const tooSmallMessage = selectionOptions.tooSmallMessage || '请拖动框选一个范围，不要单击。';
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
			eda.sys_Message.showToastMessage(toastMessage, ESYS_ToastMessageType.INFO, 3);

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
						eda.sys_Message.showToastMessage(tooSmallMessage, ESYS_ToastMessageType.WARNING, 3);
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
		// 在用户框选范围时并行预热文字多边形，尽量把等待隐藏掉。
		const assetMapPromise = prepareTextAssetMap(artifacts.items, settings);
		const selection = await waitForRangeSelection({
			followMouseTip: '请在 PCB 画布上框选生成范围。',
			toastMessage: '请在 PCB 中框选生成范围。',
			tooSmallMessage: '请拖动框选一个范围，不要单击。',
		});
		const translatedItems = layoutArtifactsFromRange(artifacts, selection.startPoint, selection.endPoint, settings);
		const assetMap = await assetMapPromise;
		const finalItems = hydratePlacedItemsWithAssetMap(translatedItems, assetMap);
		const autoAdjustedCount = finalItems.filter(item => item.type === 'image' && Number(item.autoScale) < 0.999).length;
		const finalHandles = await createFinalGroup(artifacts.layer, finalItems, false);
		if (!finalHandles.length) {
			throw new Error('生成失败，请重试。');
		}

		try {
			const totalCreated = await finalizePlacedGroup(artifacts.layer, finalItems, finalHandles);
			return {
				totalCreated,
				handles: finalHandles,
				autoAdjustedCount,
			};
		}
		catch (error) {
			await deleteFinalGroup(finalHandles).catch(() => {});
			throw error;
		}
	}

	function findNearestImageForTarget(existingImages, usedPrimitiveIds, target, tolerance) {
		let bestMatch;
		for (const existingImage of existingImages) {
			const primitiveId = normalizeText(existingImage.getState_PrimitiveId && existingImage.getState_PrimitiveId());
			if (!primitiveId || usedPrimitiveIds.has(primitiveId)) {
				continue;
			}

			const center = getImageCenterFromTopLeft(
				Number(existingImage.getState_X && existingImage.getState_X()) || 0,
				Number(existingImage.getState_Y && existingImage.getState_Y()) || 0,
				Number(existingImage.getState_Width && existingImage.getState_Width()) || 0,
				Number(existingImage.getState_Height && existingImage.getState_Height()) || 0,
				Number(existingImage.getState_Rotation && existingImage.getState_Rotation()) || 0,
			);
			const distance = Math.hypot(center.x - target.centerX, center.y - target.centerY);
			if (distance > tolerance) {
				continue;
			}

			if (!bestMatch || distance < bestMatch.distance) {
				bestMatch = {
					distance,
					primitiveId,
					primitive: existingImage,
				};
			}
		}
		return bestMatch;
	}

	function findNearestLineForTarget(existingLines, usedPrimitiveIds, target, tolerance) {
		let bestMatch;
		for (const existingLine of existingLines) {
			const primitiveId = normalizeText(existingLine.getState_PrimitiveId && existingLine.getState_PrimitiveId());
			if (!primitiveId || usedPrimitiveIds.has(primitiveId)) {
				continue;
			}

			const sameDirection = Math.hypot(
				(Number(existingLine.getState_StartX && existingLine.getState_StartX()) || 0) - target.startX,
				(Number(existingLine.getState_StartY && existingLine.getState_StartY()) || 0) - target.startY,
			) + Math.hypot(
				(Number(existingLine.getState_EndX && existingLine.getState_EndX()) || 0) - target.endX,
				(Number(existingLine.getState_EndY && existingLine.getState_EndY()) || 0) - target.endY,
			);
			const reverseDirection = Math.hypot(
				(Number(existingLine.getState_StartX && existingLine.getState_StartX()) || 0) - target.endX,
				(Number(existingLine.getState_StartY && existingLine.getState_StartY()) || 0) - target.endY,
			) + Math.hypot(
				(Number(existingLine.getState_EndX && existingLine.getState_EndX()) || 0) - target.startX,
				(Number(existingLine.getState_EndY && existingLine.getState_EndY()) || 0) - target.startY,
			);
			const distance = Math.min(sameDirection, reverseDirection);
			if (distance > tolerance * 2) {
				continue;
			}

			if (!bestMatch || distance < bestMatch.distance) {
				bestMatch = {
					distance,
					primitiveId,
					primitive: existingLine,
				};
			}
		}
		return bestMatch;
	}

	async function deleteArtifactsByRangeSelection(header, settings) {
		const selection = await waitForRangeSelection({
			followMouseTip: '请在 PCB 画布上框选要删除的丝印范围。',
			toastMessage: '请在 PCB 中框选要删除的丝印范围。',
			tooSmallMessage: '请拖动框选要删除的范围，不要单击。',
		});
		const deletionTargets = getDeletionTargetsFromRange(header, selection.startPoint, selection.endPoint);
		const layers = getDeleteTargetLayers(header, settings);
		let deletedCount = 0;

		for (const layer of layers) {
			const existingImages = asArray(await eda.pcb_PrimitiveImage.getAll(layer));
			const existingLines = asArray(await eda.pcb_PrimitiveLine.getAll(undefined, layer));
			const usedImageIds = new Set();
			const usedLineIds = new Set();
			const imagesToDelete = [];
			const linesToDelete = [];

			for (const target of deletionTargets.targets) {
				const match = findNearestImageForTarget(existingImages, usedImageIds, target, deletionTargets.tolerance);
				if (!match) {
					continue;
				}
				usedImageIds.add(match.primitiveId);
				imagesToDelete.push(match.primitive);
			}

			for (const shellItem of deletionTargets.shellItems) {
				const match = findNearestLineForTarget(existingLines, usedLineIds, shellItem, deletionTargets.tolerance);
				if (!match) {
					continue;
				}
				usedLineIds.add(match.primitiveId);
				linesToDelete.push(match.primitive);
			}

			if (imagesToDelete.length) {
				await eda.pcb_PrimitiveImage.delete(imagesToDelete);
				deletedCount += imagesToDelete.length;
			}
			if (linesToDelete.length) {
				await eda.pcb_PrimitiveLine.delete(linesToDelete);
				deletedCount += linesToDelete.length;
			}
		}

		return deletedCount;
	}

	async function createFinalHandle(layer, item, primitiveLock) {
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
			return createdImage ? { type: 'image', primitive: createdImage } : undefined;
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
		return createdLine ? { type: 'line', primitive: createdLine } : undefined;
	}

	async function createFinalGroup(layer, items, primitiveLock) {
		const handles = [];
		for (let index = 0; index < items.length; index += CREATE_BATCH_SIZE) {
			const batchItems = items.slice(index, index + CREATE_BATCH_SIZE);
			const batchHandles = await Promise.all(
				batchItems.map(item => createFinalHandle(layer, item, primitiveLock)),
			);
			for (const handle of batchHandles) {
				if (handle) {
					handles.push(handle);
				}
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
			const placementSettings = { ...appState.currentSettings };
			const header = await resolveSelectedHeader();
			const artifacts = await buildHeaderArtifacts(header, placementSettings);
			if (!artifacts.items.length) {
				eda.sys_Message.showToastMessage('没有可生成的丝印。', ESYS_ToastMessageType.WARNING, 3);
				return;
			}

			const result = await createCombinedSilkAtMouse(artifacts, placementSettings);
			await rememberGeneratedArtifacts(header, artifacts.layer, result.handles).catch(() => {});
			const autoShrinkText = result.autoAdjustedCount > 0
				? `，其中 ${result.autoAdjustedCount} 个丝印按密度自动缩小`
				: '';
			eda.sys_Message.showToastMessage(`已按框选范围生成，共 ${result.totalCreated} 个图元${autoShrinkText}。`, ESYS_ToastMessageType.SUCCESS, 2);
			void eda.pcb_SelectControl.clearSelected().catch(() => {});
		}
		catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			eda.sys_Message.showToastMessage(message, ESYS_ToastMessageType.ERROR, 4);
		}
	}

	async function startDeleteGenerated() {
		syncSettingsFromForm();

		try {
			const deleteSettings = { ...appState.currentSettings };
			const header = await resolveSelectedHeader();
			const scope = await getCurrentDocumentScope();
			const storedGroups = loadArtifactGroups();
			const matchedGroups = storedGroups.filter(group => doesArtifactGroupMatchHeader(group, scope, header));
			let deletedCount = 0;

			if (matchedGroups.length) {
				for (const group of matchedGroups) {
					deletedCount += await deleteArtifactGroupByRecord(group);
				}
				saveArtifactGroups(storedGroups.filter(group => !doesArtifactGroupMatchHeader(group, scope, header)));
			}
			else {
				deletedCount = await deleteArtifactsByRangeSelection(header, deleteSettings);
			}

			if (!deletedCount) {
				eda.sys_Message.showToastMessage('没有找到可删除的丝印。', ESYS_ToastMessageType.WARNING, 3);
				return;
			}

			eda.sys_Message.showToastMessage(`已删除 ${deletedCount} 个图元。`, ESYS_ToastMessageType.SUCCESS, 2);
			void eda.pcb_SelectControl.clearSelected().catch(() => {});
		}
		catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			eda.sys_Message.showToastMessage(message, ESYS_ToastMessageType.ERROR, 4);
		}
}

export {
	resolveSelectedHeader,
	startDeleteGenerated,
	startPlacement,
};

