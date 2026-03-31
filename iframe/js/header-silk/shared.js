const STORAGE_KEY = 'header_silk_settings_v2';
	const ARTIFACT_STORAGE_KEY = 'header_silk_artifacts_v1';
	const MANUAL_LABEL_OVERRIDE_STORAGE_KEY = 'header_silk_manual_labels_v1';
	const PANEL_ID = 'header-silk-panel';
	const PCB_LAYER_TOP = 1;
	const PCB_LAYER_BOTTOM = 2;
	const PCB_LAYER_TOP_SILK = 3;
	const PCB_LAYER_BOTTOM_SILK = 4;
	const TEXT_RENDER_FONT_PX = 192;
	const TEXT_RENDER_FONT_WEIGHT = 400;
	const TEXT_RENDER_PADDING_X_PX = 12;
	const TEXT_RENDER_PADDING_Y_PX = 10;
	const RANGE_SELECTION_EVENT_ID = 'header-silk-range-select';
	const MIN_RANGE_SELECTION_DISTANCE = 5;
	const AUTO_SHRINK_GAP_RATIO_MAJOR = 0.88;
	const AUTO_SHRINK_GAP_RATIO_MINOR = 0.82;
	const MIN_AUTO_SHRINK_SCALE = 0.68;
	const AUTO_SHRINK_EASE = 0.72;
	const PREVIEW_BASE_IMAGE_HEIGHT_PX = 28;
	const MAX_STORED_ARTIFACT_GROUPS = 80;
	const MAX_HEADER_PARSE_CACHE = 24;
	const MAX_HEADER_GEOMETRY_CACHE = 24;
	const MAX_TEXT_ASSET_CACHE = 160;
	const MAX_STORED_LABEL_OVERRIDE_COMPONENTS = 120;
	const LABEL_PREVIEW_SELECTION_POLL_MS = 700;
	const CREATE_BATCH_SIZE = 8;

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
		labelMapText: '',
	};

const elements = {
		panelSubtitle: document.getElementById('panel-subtitle'),
		tabs: Array.from(document.querySelectorAll('[data-tab-target]')),
		tabPanels: Array.from(document.querySelectorAll('[data-tab-panel]')),
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
		labelMap: document.getElementById('label-map'),
		includeShell: document.getElementById('include-shell'),
		invert: document.getElementById('invert'),
		reset: document.getElementById('reset'),
		deleteGenerated: document.getElementById('delete-generated'),
		generate: document.getElementById('generate'),
		previewCanvas: document.getElementById('preview-canvas'),
		previewSummary: document.getElementById('preview-summary'),
		refreshLabelPreview: document.getElementById('refresh-label-preview'),
		clearLabelOverrides: document.getElementById('clear-label-overrides'),
		labelPreviewMeta: document.getElementById('label-preview-meta'),
		labelPreviewList: document.getElementById('label-preview-list'),
	};

const appState = {
	currentSettings: loadSettings(),
	labelPreviewRefreshTimer: undefined,
	labelPreviewRequestId: 0,
	lastLabelPreviewSelectionSignature: '',
	labelPreviewSelectionWatcher: undefined,
};
const headerParseCache = new Map();
const headerGeometryCache = new Map();
const textAssetCache = new Map();
const manualLabelOverrideCache = loadManualLabelOverrideCache();

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

	function touchMapEntry(map, key, value) {
		if (map.has(key)) {
			map.delete(key);
		}
		map.set(key, value);
	}

	function trimMapSize(map, maxSize, protectedKey) {
		while (map.size > maxSize) {
			const oldestKey = map.keys().next().value;
			if (oldestKey == null) {
				return;
			}
			if (oldestKey === protectedKey && map.size > 1) {
				const protectedValue = map.get(oldestKey);
				map.delete(oldestKey);
				map.set(oldestKey, protectedValue);
				continue;
			}
			map.delete(oldestKey);
		}
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

	function escapeRegExp(text) {
		return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function wildcardToRegExpSource(pattern) {
		let source = '';
		for (const character of String(pattern || '')) {
			if (character === '*') {
				source += '(.*)';
				continue;
			}
			if (character === '?') {
				source += '(.)';
				continue;
			}
			source += escapeRegExp(character);
		}
		return source;
	}

	function sanitizeRegexFlags(flags) {
		const normalizedFlags = String(flags || '').replace(/[gy]/g, '');
		return [...new Set(normalizedFlags.split(''))].join('');
	}

	function buildPatternMappingRule(source, target) {
		const normalizedSource = normalizeText(source);
		if (!normalizedSource) {
			return undefined;
		}

		const regexLiteralMatch = normalizedSource.match(/^\/(.+)\/([dgimsuvy]*)$/);
		if (regexLiteralMatch) {
			try {
				return {
					regex: new RegExp(regexLiteralMatch[1], sanitizeRegexFlags(regexLiteralMatch[2])),
					target,
				};
			}
			catch {
				return undefined;
			}
		}

		if (normalizedSource.startsWith('re:')) {
			try {
				return {
					regex: new RegExp(`^(?:${normalizedSource.slice(3).trim()})$`, 'i'),
					target,
				};
			}
			catch {
				return undefined;
			}
		}

		if (normalizedSource.includes('*') || normalizedSource.includes('?')) {
			return {
				regex: new RegExp(`^${wildcardToRegExpSource(normalizedSource)}$`, 'i'),
				target,
			};
		}

		return undefined;
	}

	function parseLabelMappings(labelMapText) {
		const mappingText = String(labelMapText || '');
		const exactRules = new Map();
		const patternRules = [];
		let size = 0;
		for (const rawLine of mappingText.split(/\r?\n+/)) {
			const line = rawLine.trim();
			if (!line || line.startsWith('#') || line.startsWith('//')) {
				continue;
			}

			const segments = line.split(/\s*(=>|->|=|:)\s*/);
			if (!segments || segments.length < 3) {
				continue;
			}

			const source = normalizeText(segments[0]);
			const target = normalizeText(segments.slice(2).join(''));
			if (!source || !target) {
				continue;
			}

			const patternRule = buildPatternMappingRule(source, target);
			if (patternRule) {
				patternRules.push(patternRule);
				size += 1;
				continue;
			}

			exactRules.set(source.toUpperCase(), target);
			size += 1;
		}
		return {
			exactRules,
			patternRules,
			size,
		};
	}

	function applyLabelMappingWithMap(label, mapping) {
		const normalizedLabel = normalizeText(label);
		if (!normalizedLabel) {
			return normalizedLabel;
		}

		const normalizedUpperCaseLabel = normalizedLabel.toUpperCase();
		if (mapping.exactRules.has(normalizedUpperCaseLabel)) {
			return mapping.exactRules.get(normalizedUpperCaseLabel) || normalizedLabel;
		}

		for (const rule of mapping.patternRules) {
			rule.regex.lastIndex = 0;
			if (!rule.regex.test(normalizedLabel)) {
				continue;
			}
			rule.regex.lastIndex = 0;
			const replacedLabel = normalizedLabel.replace(rule.regex, rule.target);
			return normalizeText(replacedLabel) || normalizedLabel;
		}

		return normalizedLabel;
	}

	function resolveDisplayLabel(netName, padNumber, settings) {
		return applyLabelMappingWithMap(
			makeSilkLabel(netName, padNumber),
			parseLabelMappings(settings && settings.labelMapText),
		);
	}

	function getHeaderManualLabelOverrides(componentId, createIfMissing) {
		const normalizedComponentId = normalizeText(componentId);
		if (!normalizedComponentId) {
			return undefined;
		}
		if (!manualLabelOverrideCache.has(normalizedComponentId) && createIfMissing) {
			touchMapEntry(manualLabelOverrideCache, normalizedComponentId, new Map());
			trimMapSize(manualLabelOverrideCache, MAX_STORED_LABEL_OVERRIDE_COMPONENTS, normalizedComponentId);
			saveManualLabelOverrideCache(manualLabelOverrideCache);
		}
		const overrideMap = manualLabelOverrideCache.get(normalizedComponentId);
		if (overrideMap) {
			touchMapEntry(manualLabelOverrideCache, normalizedComponentId, overrideMap);
		}
		return overrideMap;
	}

	function createHeaderPadOverrideKey(pad) {
		return normalizeText(pad && pad.cachePadKey)
			|| `${normalizeText(pad && pad.primitiveId)}:${normalizeText(pad && pad.padNumber)}`;
	}

	function getManualLabelOverrideByKey(componentId, padKey) {
		const overrideMap = getHeaderManualLabelOverrides(componentId, false);
		if (!overrideMap) {
			return '';
		}
		return normalizeText(overrideMap.get(normalizeText(padKey)));
	}

	function setManualLabelOverrideByKey(componentId, padKey, nextLabel, autoLabel) {
		const normalizedComponentId = normalizeText(componentId);
		const normalizedPadKey = normalizeText(padKey);
		if (!normalizedComponentId || !normalizedPadKey) {
			return '';
		}

		const normalizedLabel = normalizeText(nextLabel);
		const normalizedAutoLabel = normalizeText(autoLabel);
		const overrideMap = getHeaderManualLabelOverrides(normalizedComponentId, Boolean(normalizedLabel));
		if (!overrideMap) {
			return '';
		}

		if (!normalizedLabel || normalizedLabel === normalizedAutoLabel) {
			overrideMap.delete(normalizedPadKey);
			if (!overrideMap.size) {
				manualLabelOverrideCache.delete(normalizedComponentId);
			}
			saveManualLabelOverrideCache(manualLabelOverrideCache);
			return '';
		}

		overrideMap.set(normalizedPadKey, normalizedLabel);
		touchMapEntry(manualLabelOverrideCache, normalizedComponentId, overrideMap);
		trimMapSize(manualLabelOverrideCache, MAX_STORED_LABEL_OVERRIDE_COMPONENTS, normalizedComponentId);
		saveManualLabelOverrideCache(manualLabelOverrideCache);
		return normalizedLabel;
	}

	function clearManualLabelOverrides(componentId) {
		const normalizedComponentId = normalizeText(componentId);
		if (!normalizedComponentId || !manualLabelOverrideCache.has(normalizedComponentId)) {
			return false;
		}
		manualLabelOverrideCache.delete(normalizedComponentId);
		saveManualLabelOverrideCache(manualLabelOverrideCache);
		return true;
	}

	function resolveHeaderPadDisplayLabel(header, pad, labelMappings) {
		const autoLabel = applyLabelMappingWithMap(makeSilkLabel(pad.netName, pad.padNumber), labelMappings);
		const manualLabel = getManualLabelOverrideByKey(header && header.componentId, createHeaderPadOverrideKey(pad));
		return {
			autoLabel,
			manualLabel,
			displayLabel: manualLabel || autoLabel,
			hasManualOverride: Boolean(manualLabel),
		};
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

function comparePadNumbers(leftPadNumber, rightPadNumber) {
	return String(leftPadNumber || '').localeCompare(String(rightPadNumber || ''), 'en', {
		numeric: true,
		sensitivity: 'base',
	});
}

	function getHeaderDisplayLabelItems(header, settings) {
		const labelMappings = parseLabelMappings(settings && settings.labelMapText);
		return header.rows.flatMap((row) =>
			[...row.pads]
				.sort((leftPad, rightPad) => {
					const padNumberOrder = comparePadNumbers(leftPad.padNumber, rightPad.padNumber);
					if (padNumberOrder !== 0) {
						return padNumberOrder;
					}
					return leftPad.majorProjection - rightPad.majorProjection;
				})
				.map((pad) => ({
					rowIndex: row.index,
					componentId: header.componentId,
					padKey: createHeaderPadOverrideKey(pad),
					padNumber: pad.padNumber,
					netName: pad.netName,
					...resolveHeaderPadDisplayLabel(header, pad, labelMappings),
				})),
		);
}

export {
	ARTIFACT_STORAGE_KEY,
	AUTO_SHRINK_EASE,
	AUTO_SHRINK_GAP_RATIO_MAJOR,
	AUTO_SHRINK_GAP_RATIO_MINOR,
	CREATE_BATCH_SIZE,
	DEFAULT_SETTINGS,
	LABEL_PREVIEW_SELECTION_POLL_MS,
	MANUAL_LABEL_OVERRIDE_STORAGE_KEY,
	MAX_HEADER_GEOMETRY_CACHE,
	MAX_HEADER_PARSE_CACHE,
	MAX_STORED_ARTIFACT_GROUPS,
	MAX_STORED_LABEL_OVERRIDE_COMPONENTS,
	MAX_TEXT_ASSET_CACHE,
	MIN_AUTO_SHRINK_SCALE,
	MIN_RANGE_SELECTION_DISTANCE,
	PANEL_ID,
	PCB_LAYER_BOTTOM,
	PCB_LAYER_BOTTOM_SILK,
	PCB_LAYER_TOP,
	PCB_LAYER_TOP_SILK,
	PREVIEW_BASE_IMAGE_HEIGHT_PX,
	RANGE_SELECTION_EVENT_ID,
	STORAGE_KEY,
	TEXT_RENDER_FONT_PX,
	TEXT_RENDER_FONT_WEIGHT,
	TEXT_RENDER_PADDING_X_PX,
	TEXT_RENDER_PADDING_Y_PX,
	appState,
	asArray,
	applyLabelMappingWithMap,
	clamp,
	clearManualLabelOverrides,
	clusterRows,
	collectPrimitiveIdsFromHandles,
	comparePadNumbers,
	createArtifactGroupId,
	createComponentStateSignature,
	createHeaderGeometryCacheKey,
	createHeaderPadOverrideKey,
	createHeaderParseCacheKey,
	createPadStateSignature,
	deleteArtifactGroupByRecord,
	doesArtifactGroupMatchHeader,
	dot,
	elements,
	escapeRegExp,
	estimatePitch,
	estimateShellBounds,
	formatNumeric,
	fromDisplayValue,
	getAxis,
	getComponentDisplayName,
	getCurrentDocumentScope,
	getHeaderDisplayLabelItems,
	getHeaderManualLabelOverrides,
	getHeaderPadPreview,
	getLayerLabel,
	getPadExtent,
	getPadHalfSpan,
	getPlacementMeta,
	getSortedUnique,
	getTextRotation,
	headerGeometryCache,
	headerParseCache,
	loadArtifactGroups,
	loadManualLabelOverrideCache,
	loadSettings,
	makeSilkLabel,
	median,
	milToMm,
	mmToMil,
	normalizeText,
	normalizeVector,
	parseLabelMappings,
	projectPoint,
	rememberBoundedCache,
	rememberGeneratedArtifacts,
	resolveDisplayLabel,
	resolveExistingImagesByIds,
	resolveExistingLinesByIds,
	resolveHeaderPadDisplayLabel,
	saveArtifactGroups,
	saveManualLabelOverrideCache,
	saveSettings,
	setManualLabelOverrideByKey,
	textAssetCache,
	toDisplayValue,
	touchMapEntry,
	trimMapSize,
	wildcardToRegExpSource,
};

	function getHeaderPadPreview(header, settings, maxItems) {
		return getHeaderDisplayLabelItems(header, settings)
			.slice(0, maxItems || 6)
			.map((item) => `${item.padNumber}:${item.displayLabel}`)
			.join('，');
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

	function loadArtifactGroups() {
		try {
			const saved = JSON.parse(localStorage.getItem(ARTIFACT_STORAGE_KEY) || '[]');
			return Array.isArray(saved) ? saved.filter(item => item && typeof item === 'object') : [];
		}
		catch {
			return [];
		}
	}

	function saveArtifactGroups(groups) {
		localStorage.setItem(
			ARTIFACT_STORAGE_KEY,
			JSON.stringify((Array.isArray(groups) ? groups : []).slice(-MAX_STORED_ARTIFACT_GROUPS)),
		);
	}

	function loadManualLabelOverrideCache() {
		try {
			const saved = JSON.parse(localStorage.getItem(MANUAL_LABEL_OVERRIDE_STORAGE_KEY) || '[]');
			const cache = new Map();
			for (const entry of asArray(saved)) {
				const componentId = normalizeText(entry && entry.componentId);
				if (!componentId) {
					continue;
				}
				const labels = new Map();
				for (const item of asArray(entry && entry.labels)) {
					const padKey = normalizeText(item && item.padKey);
					const label = normalizeText(item && item.label);
					if (!padKey || !label) {
						continue;
					}
					labels.set(padKey, label);
				}
				if (labels.size) {
					cache.set(componentId, labels);
				}
			}
			trimMapSize(cache, MAX_STORED_LABEL_OVERRIDE_COMPONENTS);
			return cache;
		}
		catch {
			return new Map();
		}
	}

	function saveManualLabelOverrideCache(cache) {
		const serialized = [];
		for (const [componentId, labels] of cache.entries()) {
			if (!componentId || !(labels instanceof Map) || !labels.size) {
				continue;
			}
			serialized.push({
				componentId,
				labels: [...labels.entries()].map(([padKey, label]) => ({ padKey, label })),
			});
		}
		localStorage.setItem(
			MANUAL_LABEL_OVERRIDE_STORAGE_KEY,
			JSON.stringify(serialized.slice(-MAX_STORED_LABEL_OVERRIDE_COMPONENTS)),
		);
	}

	function createArtifactGroupId() {
		return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	}

	function createComponentStateSignature(componentId, componentLayer, componentX, componentY, componentRotation) {
		return [
			normalizeText(componentId),
			String(Number(componentLayer) || 0),
			String(Math.round((Number(componentX) || 0) * 1000) / 1000),
			String(Math.round((Number(componentY) || 0) * 1000) / 1000),
			String(Math.round((Number(componentRotation) || 0) * 1000) / 1000),
		].join('::');
	}

	function createPadStateSignature(componentPadStates, options) {
		const includeNet = Boolean(options && options.includeNet);
		return asArray(componentPadStates)
			.map(item => ({
				primitiveId: normalizeText(item && item.primitiveId),
				padNumber: normalizeText(item && item.padNumber),
				net: includeNet ? normalizeText(item && item.net) : '',
			}))
			.sort((leftPad, rightPad) => {
				const leftKey = `${leftPad.primitiveId}:${leftPad.padNumber}`;
				const rightKey = `${rightPad.primitiveId}:${rightPad.padNumber}`;
				return leftKey.localeCompare(rightKey, 'en', {
					numeric: true,
					sensitivity: 'base',
				});
			})
			.map(item => includeNet
				? `${item.primitiveId}:${item.padNumber}:${item.net}`
				: `${item.primitiveId}:${item.padNumber}`)
			.join('|');
	}

	function createHeaderGeometryCacheKey(componentId, componentLayer, componentX, componentY, componentRotation, componentPadStates) {
		return [
			createComponentStateSignature(componentId, componentLayer, componentX, componentY, componentRotation),
			createPadStateSignature(componentPadStates, { includeNet: false }),
		].join('::');
	}

	function createHeaderParseCacheKey(componentId, componentLayer, componentX, componentY, componentRotation, componentPadStates) {
		return [
			createComponentStateSignature(componentId, componentLayer, componentX, componentY, componentRotation),
			createPadStateSignature(componentPadStates, { includeNet: true }),
		].join('::');
	}

	function rememberBoundedCache(cache, cacheKey, value, maxSize) {
		if (!cacheKey || !value) {
			return;
		}

		if (cache.has(cacheKey)) {
			cache.delete(cacheKey);
		}
		cache.set(cacheKey, value);
		while (cache.size > maxSize) {
			const oldestKey = cache.keys().next().value;
			if (!oldestKey) {
				break;
			}
			cache.delete(oldestKey);
		}
	}

	async function getCurrentDocumentScope() {
		try {
			const currentDocumentInfo = await eda.dmt_SelectControl.getCurrentDocumentInfo();
			return {
				documentUuid: normalizeText(currentDocumentInfo && currentDocumentInfo.uuid),
				parentProjectUuid: normalizeText(currentDocumentInfo && currentDocumentInfo.parentProjectUuid),
			};
		}
		catch {
			return {
				documentUuid: '',
				parentProjectUuid: '',
			};
		}
	}

	function doesArtifactGroupMatchHeader(group, scope, header) {
		if (!group || typeof group !== 'object') {
			return false;
		}

		if (normalizeText(group.headerComponentId) !== normalizeText(header.componentId)) {
			return false;
		}

		const groupDocumentUuid = normalizeText(group.documentUuid);
		const groupProjectUuid = normalizeText(group.parentProjectUuid);
		if (scope.documentUuid && groupDocumentUuid && groupDocumentUuid !== scope.documentUuid) {
			return false;
		}
		if (scope.parentProjectUuid && groupProjectUuid && groupProjectUuid !== scope.parentProjectUuid) {
			return false;
		}
		return true;
	}

	function collectPrimitiveIdsFromHandles(handles) {
		return handles.reduce((accumulator, handle) => {
			const primitiveId = handle && handle.primitive && handle.primitive.getState_PrimitiveId && handle.primitive.getState_PrimitiveId();
			if (!primitiveId) {
				return accumulator;
			}
			if (handle.type === 'image') {
				accumulator.imagePrimitiveIds.push(String(primitiveId));
			}
			else if (handle.type === 'line') {
				accumulator.linePrimitiveIds.push(String(primitiveId));
			}
			return accumulator;
		}, {
			imagePrimitiveIds: [],
			linePrimitiveIds: [],
		});
	}

	async function rememberGeneratedArtifacts(header, layer, handles) {
		const primitiveIds = collectPrimitiveIdsFromHandles(handles);
		if (!primitiveIds.imagePrimitiveIds.length && !primitiveIds.linePrimitiveIds.length) {
			return;
		}

		const scope = await getCurrentDocumentScope();
		const groups = loadArtifactGroups();
		groups.push({
			id: createArtifactGroupId(),
			documentUuid: scope.documentUuid,
			parentProjectUuid: scope.parentProjectUuid,
			headerComponentId: normalizeText(header.componentId),
			designator: normalizeText(header.designator),
			layer: Number(layer) || 0,
			imagePrimitiveIds: primitiveIds.imagePrimitiveIds,
			linePrimitiveIds: primitiveIds.linePrimitiveIds,
			createdAt: new Date().toISOString(),
		});
		saveArtifactGroups(groups);
	}

	async function resolveExistingImagesByIds(primitiveIds) {
		const normalizedIds = [...new Set(asArray(primitiveIds).map(item => normalizeText(item)).filter(Boolean))];
		if (!normalizedIds.length) {
			return [];
		}

		return asArray(await eda.pcb_PrimitiveImage.get(normalizedIds));
	}

	async function resolveExistingLinesByIds(primitiveIds) {
		const normalizedIds = [...new Set(asArray(primitiveIds).map(item => normalizeText(item)).filter(Boolean))];
		if (!normalizedIds.length) {
			return [];
		}

		return asArray(await eda.pcb_PrimitiveLine.get(normalizedIds));
	}

	async function deleteArtifactGroupByRecord(group) {
		const images = await resolveExistingImagesByIds(group && group.imagePrimitiveIds);
		const lines = await resolveExistingLinesByIds(group && group.linePrimitiveIds);
		if (images.length) {
			await eda.pcb_PrimitiveImage.delete(images);
		}
		if (lines.length) {
			await eda.pcb_PrimitiveLine.delete(lines);
		}
		return images.length + lines.length;
	}

