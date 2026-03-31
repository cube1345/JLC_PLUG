import {
	LABEL_PREVIEW_SELECTION_POLL_MS,
	DEFAULT_SETTINGS,
	appState,
	asArray,
	clamp,
	clearManualLabelOverrides,
	elements,
	formatNumeric,
	fromDisplayValue,
	getHeaderDisplayLabelItems,
	normalizeText,
	saveSettings,
	setManualLabelOverrideByKey,
	toDisplayValue,
} from './shared.js';
import { renderPreview } from './rendering.js';
import { resolveSelectedHeader, startDeleteGenerated, startPlacement } from './workflow.js';

function activateTab(tabName) {
		elements.tabs.forEach((tabButton) => {
			const isActive = tabButton.dataset.tabTarget === tabName;
			tabButton.classList.toggle('is-active', isActive);
			tabButton.setAttribute('aria-selected', isActive ? 'true' : 'false');
		});

		elements.tabPanels.forEach((tabPanel) => {
			const isActive = tabPanel.dataset.tabPanel === tabName;
			tabPanel.classList.toggle('is-active', isActive);
			tabPanel.hidden = !isActive;
		});
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
		elements.labelMap.value = settings.labelMapText || '';
		elements.includeShell.checked = Boolean(settings.includeShell);
		elements.invert.checked = Boolean(settings.invert);
		refreshUnitBadges(settings.unitMode);
		renderPreview();
	}

	function syncSettingsFromForm() {
		appState.currentSettings.fontFamily = elements.fontFamily.value || DEFAULT_SETTINGS.fontFamily;
		appState.currentSettings.layerMode = elements.layerMode.value || DEFAULT_SETTINGS.layerMode;
		appState.currentSettings.fontSizeMil = clamp(fromDisplayValue(Number(elements.fontSize.value) || 0, appState.currentSettings.unitMode), 10, 240);
		appState.currentSettings.strokeWidthMil = clamp(fromDisplayValue(Number(elements.strokeWidth.value) || 0, appState.currentSettings.unitMode), 0, 80);
		appState.currentSettings.positionMode = elements.positionMode.value || DEFAULT_SETTINGS.positionMode;
		appState.currentSettings.rotationMode = elements.rotationMode.value || DEFAULT_SETTINGS.rotationMode;
		appState.currentSettings.offsetMil = clamp(fromDisplayValue(Number(elements.offset.value) || 0, appState.currentSettings.unitMode), 1, 300);
		appState.currentSettings.labelMapText = elements.labelMap.value || '';
		appState.currentSettings.includeShell = elements.includeShell.checked;
		appState.currentSettings.invert = elements.invert.checked;
		saveSettings(appState.currentSettings);
	}


	function renderLabelPreviewState(metaText, chips, options) {
		const meta = elements.labelPreviewMeta;
		const list = elements.labelPreviewList;
		if (!meta || !list) {
			return;
		}

		meta.textContent = metaText;
		list.innerHTML = '';

		for (const chip of chips) {
			if (chip && chip.editable) {
				const rowElement = document.createElement('label');
				rowElement.className = chip.hasManualOverride ? 'label-edit-row is-manual' : 'label-edit-row';

				const metaElement = document.createElement('div');
				metaElement.className = 'label-edit-meta';
				const padElement = document.createElement('strong');
				padElement.textContent = chip.padNumber || '?';
				const sourceElement = document.createElement('span');
				sourceElement.textContent = chip.netName || chip.autoLabel || '未命名网络';
				sourceElement.title = chip.netName || chip.autoLabel || '未命名网络';
				metaElement.appendChild(padElement);
				metaElement.appendChild(sourceElement);

				const inputElement = document.createElement('input');
				inputElement.className = chip.hasManualOverride ? 'label-edit-input is-manual' : 'label-edit-input';
				inputElement.type = 'text';
				inputElement.value = chip.displayLabel || '';
				inputElement.placeholder = chip.autoLabel || chip.displayLabel || '';
				inputElement.title = chip.autoLabel ? `默认标签：${chip.autoLabel}` : '默认标签';

				const syncManualState = (restoreAutoWhenEmpty) => {
					const normalizedInput = normalizeText(inputElement.value);
					if (!normalizedInput) {
						setManualLabelOverrideByKey(chip.componentId, chip.padKey, '', chip.autoLabel);
						rowElement.className = 'label-edit-row';
						inputElement.className = 'label-edit-input';
						if (restoreAutoWhenEmpty) {
							inputElement.value = chip.autoLabel || '';
						}
						return;
					}

					const storedLabel = setManualLabelOverrideByKey(
						chip.componentId,
						chip.padKey,
						normalizedInput,
						chip.autoLabel,
					);
					const isManual = Boolean(storedLabel);
					rowElement.className = isManual ? 'label-edit-row is-manual' : 'label-edit-row';
					inputElement.className = isManual ? 'label-edit-input is-manual' : 'label-edit-input';
					if (!isManual) {
						inputElement.value = chip.autoLabel || '';
					}
				};

				inputElement.addEventListener('input', () => syncManualState(false));
				inputElement.addEventListener('change', () => syncManualState(true));
				inputElement.addEventListener('blur', () => syncManualState(true));

				rowElement.appendChild(metaElement);
				rowElement.appendChild(inputElement);
				list.appendChild(rowElement);
				continue;
			}

			const chipElement = document.createElement('span');
			chipElement.className = chip.muted ? 'label-chip is-muted' : 'label-chip';
			if (chip.padNumber) {
				const padElement = document.createElement('strong');
				padElement.textContent = chip.padNumber;
				chipElement.appendChild(padElement);
				chipElement.appendChild(document.createTextNode(`:${chip.text}`));
			}
			else {
				chipElement.textContent = chip.text;
			}
			list.appendChild(chipElement);
		}

		if (!chips.length && options && options.emptyText) {
			const chipElement = document.createElement('span');
			chipElement.className = 'label-chip is-muted';
			chipElement.textContent = options.emptyText;
			list.appendChild(chipElement);
		}
	}

	async function refreshLabelPreview() {
		const requestId = ++appState.labelPreviewRequestId;
		renderLabelPreviewState('正在读取当前排针...', [], { emptyText: '读取中' });

		try {
			const header = await resolveSelectedHeader();
			if (requestId !== appState.labelPreviewRequestId) {
				return;
			}

			const labelItems = getHeaderDisplayLabelItems(header, appState.currentSettings);
			const manualOverrideCount = labelItems.filter(item => item.hasManualOverride).length;
			const visibleItems = labelItems.map((item) => ({
				editable: true,
				componentId: item.componentId,
				padKey: item.padKey,
				padNumber: item.padNumber,
				netName: item.netName,
				autoLabel: item.autoLabel || item.netName || `P${item.padNumber || '?'}`,
				displayLabel: item.displayLabel || item.netName || `P${item.padNumber || '?'}`,
				hasManualOverride: item.hasManualOverride,
			}));

			renderLabelPreviewState(
				`${header.designator} · ${header.padCount} Pin · ${header.rows.length} 行 · 手改 ${manualOverrideCount} 项（自动保存）`,
				visibleItems,
				{ emptyText: '没有可显示的标签' },
			);
		}
		catch (error) {
			if (requestId !== appState.labelPreviewRequestId) {
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			renderLabelPreviewState(message, [], { emptyText: '等待选择' });
		}
	}

	function scheduleLabelPreviewRefresh(delayMs) {
		if (appState.labelPreviewRefreshTimer) {
			clearTimeout(appState.labelPreviewRefreshTimer);
		}
		appState.labelPreviewRefreshTimer = setTimeout(() => {
			appState.labelPreviewRefreshTimer = undefined;
			void refreshLabelPreview();
		}, delayMs == null ? 180 : delayMs);
	}

	async function getSelectedComponentSignature() {
		if (!eda.pcb_SelectControl) {
			return '';
		}

		const selectedPrimitives = asArray(await eda.pcb_SelectControl.getAllSelectedPrimitives());
		const componentIds = new Set();
		for (const primitive of selectedPrimitives) {
			const primitiveType = String(primitive.getState_PrimitiveType && primitive.getState_PrimitiveType());
			if (primitiveType === 'Component') {
				componentIds.add(normalizeText(primitive.getState_PrimitiveId && primitive.getState_PrimitiveId()));
				continue;
			}
			if (primitiveType === 'ComponentPad') {
				componentIds.add(normalizeText(primitive.getState_ParentComponentPrimitiveId && primitive.getState_ParentComponentPrimitiveId()));
			}
		}
		return [...componentIds].filter(Boolean).sort().join('|');
	}

	function startLabelPreviewSelectionWatcher() {
		if (appState.labelPreviewSelectionWatcher) {
			clearInterval(appState.labelPreviewSelectionWatcher);
		}

		let pollInFlight = false;
		appState.labelPreviewSelectionWatcher = setInterval(async () => {
			if (pollInFlight) {
				return;
			}
			pollInFlight = true;
			try {
				const selectionSignature = await getSelectedComponentSignature();
				if (selectionSignature === appState.lastLabelPreviewSelectionSignature) {
					return;
				}
				appState.lastLabelPreviewSelectionSignature = selectionSignature;
				scheduleLabelPreviewRefresh(0);
			}
			catch {}
			finally {
				pollInFlight = false;
			}
		}, LABEL_PREVIEW_SELECTION_POLL_MS);
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

	function bindSettings() {
		elements.tabs.forEach((tabButton) => {
			tabButton.addEventListener('click', () => {
				const tabName = tabButton.dataset.tabTarget || 'compact';
				activateTab(tabName);
				if (tabName === 'layout') {
					scheduleLabelPreviewRefresh(0);
				}
			});
		});

		elements.fontFamily.addEventListener('change', () => {
			appState.currentSettings.fontFamily = elements.fontFamily.value || DEFAULT_SETTINGS.fontFamily;
			saveSettings(appState.currentSettings);
			renderPreview();
		});

		elements.unitMode.addEventListener('change', () => {
			syncSettingsFromForm();
			appState.currentSettings.unitMode = elements.unitMode.value === 'mm' ? 'mm' : 'mil';
			saveSettings(appState.currentSettings);
			applySettings(appState.currentSettings);
		});

		elements.layerMode.addEventListener('change', () => {
			appState.currentSettings.layerMode = elements.layerMode.value || DEFAULT_SETTINGS.layerMode;
			saveSettings(appState.currentSettings);
			renderPreview();
		});

		elements.fontSize.addEventListener('input', () => {
			appState.currentSettings.fontSizeMil = clamp(fromDisplayValue(Number(elements.fontSize.value) || 0, appState.currentSettings.unitMode), 10, 240);
			saveSettings(appState.currentSettings);
			renderPreview();
		});

		elements.strokeWidth.addEventListener('input', () => {
			appState.currentSettings.strokeWidthMil = clamp(fromDisplayValue(Number(elements.strokeWidth.value) || 0, appState.currentSettings.unitMode), 0, 80);
			saveSettings(appState.currentSettings);
			renderPreview();
		});

		elements.positionMode.addEventListener('change', () => {
			appState.currentSettings.positionMode = elements.positionMode.value || DEFAULT_SETTINGS.positionMode;
			saveSettings(appState.currentSettings);
			renderPreview();
		});

		elements.rotationMode.addEventListener('change', () => {
			appState.currentSettings.rotationMode = elements.rotationMode.value || DEFAULT_SETTINGS.rotationMode;
			saveSettings(appState.currentSettings);
			renderPreview();
		});

		elements.offset.addEventListener('input', () => {
			appState.currentSettings.offsetMil = clamp(fromDisplayValue(Number(elements.offset.value) || 0, appState.currentSettings.unitMode), 1, 300);
			saveSettings(appState.currentSettings);
			renderPreview();
		});

		elements.labelMap.addEventListener('input', () => {
			appState.currentSettings.labelMapText = elements.labelMap.value || '';
			saveSettings(appState.currentSettings);
			renderPreview();
			scheduleLabelPreviewRefresh(120);
		});

		elements.includeShell.addEventListener('change', () => {
			appState.currentSettings.includeShell = elements.includeShell.checked;
			saveSettings(appState.currentSettings);
			renderPreview();
		});

		elements.invert.addEventListener('change', () => {
			appState.currentSettings.invert = elements.invert.checked;
			saveSettings(appState.currentSettings);
			renderPreview();
		});

		elements.reset.addEventListener('click', () => {
			appState.currentSettings = { ...DEFAULT_SETTINGS };
			saveSettings(appState.currentSettings);
			applySettings(appState.currentSettings);
			scheduleLabelPreviewRefresh(0);
		});

		elements.refreshLabelPreview.addEventListener('click', () => {
			syncSettingsFromForm();
			void refreshLabelPreview();
		});

		elements.clearLabelOverrides.addEventListener('click', async () => {
			try {
				const header = await resolveSelectedHeader();
				if (!clearManualLabelOverrides(header.componentId)) {
					eda.sys_Message.showToastMessage('当前排针没有已保存的手改标签。', ESYS_ToastMessageType.WARNING, 3);
					return;
				}
				await refreshLabelPreview();
				eda.sys_Message.showToastMessage('已清空当前排针的手改标签。', ESYS_ToastMessageType.SUCCESS, 2);
			}
			catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				eda.sys_Message.showToastMessage(message, ESYS_ToastMessageType.ERROR, 4);
			}
		});

		elements.deleteGenerated.addEventListener('click', () => {
			void startDeleteGenerated();
		});

		elements.generate.addEventListener('click', () => {
			void startPlacement();
		});
	}

	window.addEventListener('DOMContentLoaded', async () => {
		await populateFontOptions(appState.currentSettings);
		activateTab('compact');
		applySettings(appState.currentSettings);
		bindSettings();
		startLabelPreviewSelectionWatcher();
		scheduleLabelPreviewRefresh(0);
	});
