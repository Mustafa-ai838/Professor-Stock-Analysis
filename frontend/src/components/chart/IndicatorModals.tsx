import { useEffect, useState } from "react";
import { Check, Plus, RotateCcw, Settings, Trash2, X } from "lucide-react";
import {
  DEFAULT_INDICATORS_STATE,
  type BollingerConfig,
  type ChartIndicatorsState,
  type LineDashStyle,
  type MaConfig,
  type MaType,
  type PriceSource,
  type RsiConfig,
  type VolumeConfig,
} from "./indicatorsMath";

export type SettingsTarget =
  | { kind: "ma"; id: string }
  | { kind: "bollinger" }
  | { kind: "rsi" }
  | { kind: "volume" };

const TV_SWATCHES = ["#1e3a8a", "#2962ff", "#ff9800", "#e11d48", "#089981", "#7e57c2", "#131722"];

const SOURCE_OPTIONS: Array<{ value: PriceSource; label: string }> = [
  { value: "close", label: "Close" },
  { value: "open", label: "Open" },
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
  { value: "hl2", label: "HL2 (High+Low)/2" },
  { value: "hlc3", label: "HLC3 (H+L+C)/3" },
  { value: "ohlc4", label: "OHLC4 (O+H+L+C)/4" },
];

const MA_TYPE_OPTIONS: Array<{ value: MaType; label: string }> = [
  { value: "SMA", label: "SMA (Simple)" },
  { value: "EMA", label: "EMA (Exponential)" },
  { value: "WMA", label: "WMA (Weighted)" },
];

const LINE_WIDTH_OPTIONS: Array<{ value: number; label: "Thin" | "Medium" | "Thick" }> = [
  { value: 1, label: "Thin" },
  { value: 2, label: "Medium" },
  { value: 4, label: "Thick" },
];

interface IndicatorsMenuProps {
  open: boolean;
  state: ChartIndicatorsState;
  onClose: () => void;
  onAddMa: () => void;
  onToggleIndicator: (kind: "bollinger" | "rsi" | "volume", enabled: boolean) => void;
  onRemoveMa: (id: string) => void;
  onOpenSettings: (target: SettingsTarget) => void;
}

export function IndicatorsMenu({
  open,
  state,
  onClose,
  onAddMa,
  onToggleIndicator,
  onRemoveMa,
  onOpenSettings,
}: IndicatorsMenuProps) {
  if (!open) return null;

  return (
    <div className="tv-modal-backdrop" onClick={onClose}>
      <div className="tv-indicators-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Indicators">
        <div className="tv-dialog-header">
          <div>
            <h3>Indicators</h3>
            <p>Add, remove, or configure chart indicators</p>
          </div>
          <button type="button" className="tv-icon-close" onClick={onClose} aria-label="Close indicators list">
            <X size={16} />
          </button>
        </div>

        <div className="tv-indicators-list">
          {/* 1. Moving Average */}
          <div className="tv-ind-row-group">
            <div className="tv-ind-row">
              <div className="tv-ind-info">
                <div className="tv-ind-name">
                  <span>Moving Average</span>
                  {state.mas.length > 0 && <span className="tv-ind-count">{state.mas.length} active</span>}
                </div>
                <div className="tv-ind-desc">Overlay trend line (SMA, EMA, WMA)</div>
              </div>
              <button type="button" className="tv-btn-add" onClick={onAddMa}>
                <Plus size={14} /> Add
              </button>
            </div>
            {state.mas.length > 0 && (
              <div className="tv-ind-sublist">
                {state.mas.map((ma) => (
                  <div key={ma.id} className="tv-ind-subitem">
                    <button
                      type="button"
                      className="tv-ind-sublink"
                      onClick={() => {
                        onClose();
                        onOpenSettings({ kind: "ma", id: ma.id });
                      }}
                    >
                      <span className="tv-color-dot" style={{ backgroundColor: ma.color }} />
                      <span>
                        {ma.type} {ma.length} ({ma.source})
                      </span>
                    </button>
                    <div className="tv-sub-actions">
                      <button
                        type="button"
                        className="tv-mini-action"
                        title="Settings"
                        onClick={() => {
                          onClose();
                          onOpenSettings({ kind: "ma", id: ma.id });
                        }}
                      >
                        <Settings size={13} />
                      </button>
                      <button
                        type="button"
                        className="tv-mini-action danger"
                        title="Remove"
                        onClick={() => onRemoveMa(ma.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 2. Bollinger Bands */}
          <div className="tv-ind-row-group">
            <div className="tv-ind-row">
              <div
                className="tv-ind-info clickable"
                onClick={() => {
                  if (state.bollinger.enabled) {
                    onClose();
                    onOpenSettings({ kind: "bollinger" });
                  }
                }}
              >
                <div className="tv-ind-name">
                  <span>Bollinger Bands</span>
                  {state.bollinger.enabled && (
                    <span className="tv-ind-count">
                      <Check size={11} /> BB {state.bollinger.length} · {state.bollinger.stdDev}
                    </span>
                  )}
                </div>
                <div className="tv-ind-desc">Upper, basis, lower volatility channel</div>
              </div>
              <div className="tv-row-actions">
                {state.bollinger.enabled ? (
                  <>
                    <button
                      type="button"
                      className="tv-mini-action"
                      title="Bollinger Bands Settings"
                      onClick={() => {
                        onClose();
                        onOpenSettings({ kind: "bollinger" });
                      }}
                    >
                      <Settings size={14} />
                    </button>
                    <button
                      type="button"
                      className="tv-btn-remove"
                      onClick={() => onToggleIndicator("bollinger", false)}
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <button type="button" className="tv-btn-add" onClick={() => onToggleIndicator("bollinger", true)}>
                    <Plus size={14} /> Add
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 3. RSI */}
          <div className="tv-ind-row-group">
            <div className="tv-ind-row">
              <div
                className="tv-ind-info clickable"
                onClick={() => {
                  if (state.rsi.enabled) {
                    onClose();
                    onOpenSettings({ kind: "rsi" });
                  }
                }}
              >
                <div className="tv-ind-name">
                  <span>RSI</span>
                  {state.rsi.enabled && (
                    <span className="tv-ind-count">
                      <Check size={11} /> RSI {state.rsi.length}
                    </span>
                  )}
                </div>
                <div className="tv-ind-desc">Relative Strength Index oscillator (lower pane)</div>
              </div>
              <div className="tv-row-actions">
                {state.rsi.enabled ? (
                  <>
                    <button
                      type="button"
                      className="tv-mini-action"
                      title="RSI Settings"
                      onClick={() => {
                        onClose();
                        onOpenSettings({ kind: "rsi" });
                      }}
                    >
                      <Settings size={14} />
                    </button>
                    <button type="button" className="tv-btn-remove" onClick={() => onToggleIndicator("rsi", false)}>
                      Remove
                    </button>
                  </>
                ) : (
                  <button type="button" className="tv-btn-add" onClick={() => onToggleIndicator("rsi", true)}>
                    <Plus size={14} /> Add
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 4. Volume */}
          <div className="tv-ind-row-group">
            <div className="tv-ind-row">
              <div
                className="tv-ind-info clickable"
                onClick={() => {
                  if (state.volume.enabled) {
                    onClose();
                    onOpenSettings({ kind: "volume" });
                  }
                }}
              >
                <div className="tv-ind-name">
                  <span>Volume</span>
                  {state.volume.enabled && (
                    <span className="tv-ind-count">
                      <Check size={11} /> Active
                    </span>
                  )}
                </div>
                <div className="tv-ind-desc">Trading volume histogram & optional Volume MA</div>
              </div>
              <div className="tv-row-actions">
                {state.volume.enabled ? (
                  <>
                    <button
                      type="button"
                      className="tv-mini-action"
                      title="Volume Settings"
                      onClick={() => {
                        onClose();
                        onOpenSettings({ kind: "volume" });
                      }}
                    >
                      <Settings size={14} />
                    </button>
                    <button type="button" className="tv-btn-remove" onClick={() => onToggleIndicator("volume", false)}>
                      Remove
                    </button>
                  </>
                ) : (
                  <button type="button" className="tv-btn-add" onClick={() => onToggleIndicator("volume", true)}>
                    <Plus size={14} /> Add
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ColorPickerFieldProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
}

function ColorPickerField({ label, value, onChange }: ColorPickerFieldProps) {
  return (
    <div className="tv-setting-field">
      <label>{label}</label>
      <div className="tv-color-row">
        {TV_SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={`tv-swatch ${value.toLowerCase() === swatch ? "selected" : ""}`}
            style={{ backgroundColor: swatch }}
            onClick={() => onChange(swatch)}
            aria-label={`Select color ${swatch}`}
          />
        ))}
        <input
          type="color"
          className="tv-native-color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} custom color`}
        />
      </div>
    </div>
  );
}

function LineWidthPicker({
  label = "Line Width",
  value,
  previewColor,
  onChange,
}: {
  label?: string;
  value: number;
  previewColor: string;
  onChange: (width: number) => void;
}) {
  const isSelected = (optVal: number) => {
    if (optVal === 4) return value >= 3;
    return value === optVal;
  };

  return (
    <div className="tv-setting-field">
      <label>{label}</label>
      <div className="tv-width-group" role="radiogroup" aria-label={label}>
        {LINE_WIDTH_OPTIONS.map((opt) => {
          const active = isSelected(opt.value);
          return (
            <button
              key={opt.label}
              type="button"
              role="radio"
              aria-checked={active}
              data-thickness={opt.label.toLowerCase()}
              className={`tv-width-btn ${active ? "active" : ""}`}
              onClick={() => onChange(opt.value)}
            >
              <span
                className="tv-thickness-bar"
                style={{ height: `${opt.value}px`, backgroundColor: previewColor }}
              />
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TvColorPickerButton({
  value,
  onChange,
  title = "Color",
}: {
  value: string;
  onChange: (color: string) => void;
  title?: string;
}) {
  return (
    <div className="tv-compact-swatch-wrap" title={title}>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="tv-compact-native-color"
        aria-label={title}
      />
      <span className="tv-compact-swatch-box" style={{ backgroundColor: value }} />
    </div>
  );
}

function TvLineStyleSelect({
  value,
  onChange,
  title = "Line Style",
}: {
  value: LineDashStyle;
  onChange: (val: LineDashStyle) => void;
  title?: string;
}) {
  return (
    <select
      className="tv-compact-style-select"
      value={value}
      onChange={(e) => onChange(e.target.value as LineDashStyle)}
      title={title}
    >
      <option value="solid">Solid ──</option>
      <option value="dashed">Dashed ╌╌</option>
      <option value="dotted">Dotted ••</option>
    </select>
  );
}

function TvLineWidthSelect({
  value,
  onChange,
  title = "Line Width",
}: {
  value: number;
  onChange: (w: number) => void;
  title?: string;
}) {
  return (
    <select
      className="tv-compact-width-select"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      title={title}
    >
      <option value={1}>1px</option>
      <option value={2}>2px</option>
      <option value={3}>3px</option>
      <option value={4}>4px</option>
    </select>
  );
}

interface IndicatorSettingsModalProps {
  target: SettingsTarget | null;
  state: ChartIndicatorsState;
  onSelectTarget?: (next: SettingsTarget) => void;
  onUpdateState: (next: ChartIndicatorsState) => void;
  onRemoveMa: (id: string) => void;
  onClose: () => void;
}

export function IndicatorSettingsModal({
  target,
  state,
  onUpdateState,
  onRemoveMa,
  onClose,
}: IndicatorSettingsModalProps) {
  const [tab, setTab] = useState<"inputs" | "style">("inputs");
  const [snapshot, setSnapshot] = useState<ChartIndicatorsState | null>(null);

  useEffect(() => {
    if (target) {
      setSnapshot(structuredClone(state));
      setTab("inputs");
    } else {
      setSnapshot(null);
    }
    // Intentional capture only on modal open target switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(target)]);

  if (!target) return null;

  const activeMa: MaConfig | undefined =
    target.kind === "ma" ? state.mas.find((m) => m.id === target.id) : undefined;

  const title =
    target.kind === "ma" && activeMa
      ? `${activeMa.type} ${activeMa.length}`
      : target.kind === "bollinger"
      ? "Bollinger Bands"
      : target.kind === "rsi"
      ? "RSI"
      : "Volume";

  const updateMa = (patch: Partial<MaConfig>) => {
    if (target.kind !== "ma") return;
    onUpdateState({
      ...state,
      mas: state.mas.map((m) => (m.id === target.id ? { ...m, ...patch } : m)),
    });
  };

  const updateBb = (patch: Partial<BollingerConfig>) =>
    onUpdateState({ ...state, bollinger: { ...state.bollinger, ...patch } });

  const updateRsi = (patch: Partial<RsiConfig>) =>
    onUpdateState({ ...state, rsi: { ...state.rsi, ...patch } });

  const updateVol = (patch: Partial<VolumeConfig>) =>
    onUpdateState({ ...state, volume: { ...state.volume, ...patch } });

  const handleReset = () => {
    if (target.kind === "ma") {
      const idx = state.mas.findIndex((m) => m.id === target.id);
      const def =
        DEFAULT_INDICATORS_STATE.mas[idx] ??
        DEFAULT_INDICATORS_STATE.mas.find((m) => m.length === activeMa?.length) ??
        DEFAULT_INDICATORS_STATE.mas[0];
      updateMa({ ...def, id: target.id });
    } else if (target.kind === "bollinger") {
      onUpdateState({ ...state, bollinger: { ...DEFAULT_INDICATORS_STATE.bollinger, enabled: true } });
    } else if (target.kind === "rsi") {
      onUpdateState({ ...state, rsi: { ...DEFAULT_INDICATORS_STATE.rsi, enabled: true } });
    } else if (target.kind === "volume") {
      onUpdateState({ ...state, volume: { ...DEFAULT_INDICATORS_STATE.volume, enabled: true } });
    }
  };

  const handleConfirm = () => {
    onUpdateState(structuredClone(state));
    onClose();
  };

  const handleCancel = () => {
    if (snapshot) onUpdateState(snapshot);
    onClose();
  };

  const handleRemove = () => {
    if (target.kind === "ma") {
      onRemoveMa(target.id);
    } else if (target.kind === "bollinger") {
      updateBb({ enabled: false });
    } else if (target.kind === "rsi") {
      updateRsi({ enabled: false });
    } else if (target.kind === "volume") {
      updateVol({ enabled: false });
    }
    onClose();
  };

  return (
    <div className="tv-modal-backdrop" onClick={handleCancel}>
      <div className="tv-settings-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Indicator Settings">
        <div className="tv-dialog-header">
          <h3>{title}</h3>
          <button type="button" className="tv-icon-close" onClick={handleCancel} aria-label="Cancel settings">
            <X size={16} />
          </button>
        </div>

        {/* Inputs / Style Tabs */}
        <div className="tv-settings-tabs">
          <button type="button" className={tab === "inputs" ? "active" : ""} onClick={() => setTab("inputs")}>
            Inputs
          </button>
          <button type="button" className={tab === "style" ? "active" : ""} onClick={() => setTab("style")}>
            Style
          </button>
        </div>

        {/* Settings Body */}
        <div className="tv-settings-body">
          {target.kind === "ma" && activeMa && tab === "inputs" && (
            <>
              <div className="tv-setting-field">
                <label>Length</label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={activeMa.length}
                  onChange={(e) => updateMa({ length: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })}
                />
              </div>
              <div className="tv-setting-field">
                <label>Source</label>
                <select value={activeMa.source} onChange={(e) => updateMa({ source: e.target.value as PriceSource })}>
                  {SOURCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="tv-setting-field">
                <label>Type</label>
                <select value={activeMa.type} onChange={(e) => updateMa({ type: e.target.value as MaType })}>
                  {MA_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="tv-setting-field">
                <label>Offset</label>
                <input
                  type="number"
                  min={-50}
                  max={50}
                  value={activeMa.offset}
                  onChange={(e) => updateMa({ offset: Math.max(-50, Math.min(50, Number(e.target.value) || 0)) })}
                />
              </div>
            </>
          )}

          {target.kind === "ma" && activeMa && tab === "style" && (
            <>
              <div className="tv-setting-field">
                <label>Show Line</label>
                <input
                  type="checkbox"
                  checked={activeMa.visible}
                  onChange={(e) => updateMa({ visible: e.target.checked })}
                />
              </div>
              <ColorPickerField label="Color" value={activeMa.color} onChange={(color) => updateMa({ color })} />
              <LineWidthPicker
                label="Line Width"
                value={activeMa.lineWidth}
                previewColor={activeMa.color}
                onChange={(lineWidth) => updateMa({ lineWidth, lineStyle: "solid" })}
              />
            </>
          )}

          {target.kind === "bollinger" && tab === "inputs" && (
            <>
              <div className="tv-setting-field">
                <label>Length</label>
                <input
                  type="number"
                  min={2}
                  max={500}
                  value={state.bollinger.length}
                  onChange={(e) => updateBb({ length: Math.max(2, Math.min(500, Number(e.target.value) || 20)) })}
                />
              </div>
              <div className="tv-setting-field">
                <label>Basis MA Type</label>
                <select
                  value={state.bollinger.basisType}
                  onChange={(e) => updateBb({ basisType: e.target.value as MaType })}
                >
                  {MA_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="tv-setting-field">
                <label>Source</label>
                <select
                  value={state.bollinger.source}
                  onChange={(e) => updateBb({ source: e.target.value as PriceSource })}
                >
                  {SOURCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="tv-setting-field">
                <label>StdDev (Multiplier)</label>
                <input
                  type="number"
                  min={0.5}
                  max={5}
                  step={0.1}
                  value={state.bollinger.stdDev}
                  onChange={(e) => updateBb({ stdDev: Math.max(0.5, Math.min(5, Number(e.target.value) || 2)) })}
                />
              </div>
              <div className="tv-setting-field">
                <label>Offset</label>
                <input
                  type="number"
                  min={-50}
                  max={50}
                  value={state.bollinger.offset}
                  onChange={(e) => updateBb({ offset: Math.max(-50, Math.min(50, Number(e.target.value) || 0)) })}
                />
              </div>
            </>
          )}

          {target.kind === "bollinger" && tab === "style" && (
            <div className="tv-tvstyle-list">
              {/* 1. Basis Line */}
              <div className="tv-tvstyle-row">
                <label className="tv-tvstyle-checklabel">
                  <input
                    type="checkbox"
                    checked={state.bollinger.showBasis}
                    onChange={(e) => updateBb({ showBasis: e.target.checked })}
                  />
                  <span>Basis</span>
                </label>
                <div className="tv-tvstyle-controls">
                  <TvColorPickerButton
                    value={state.bollinger.basisColor}
                    onChange={(basisColor) => updateBb({ basisColor })}
                    title="Basis Line Color"
                  />
                  <TvLineStyleSelect
                    value={state.bollinger.basisLineStyle || "solid"}
                    onChange={(basisLineStyle) => updateBb({ basisLineStyle })}
                    title="Basis Line Style"
                  />
                  <TvLineWidthSelect
                    value={state.bollinger.basisLineWidth || 1}
                    onChange={(basisLineWidth) => updateBb({ basisLineWidth })}
                    title="Basis Line Thickness"
                  />
                </div>
              </div>

              {/* 2. Upper Band */}
              <div className="tv-tvstyle-row">
                <label className="tv-tvstyle-checklabel">
                  <input
                    type="checkbox"
                    checked={state.bollinger.showUpper !== false}
                    onChange={(e) => updateBb({ showUpper: e.target.checked })}
                  />
                  <span>Upper</span>
                </label>
                <div className="tv-tvstyle-controls">
                  <TvColorPickerButton
                    value={state.bollinger.upperColor || state.bollinger.bandColor || "#2196f3"}
                    onChange={(upperColor) => updateBb({ upperColor, bandColor: upperColor })}
                    title="Upper Band Color"
                  />
                  <TvLineStyleSelect
                    value={state.bollinger.upperLineStyle || "solid"}
                    onChange={(upperLineStyle) => updateBb({ upperLineStyle })}
                    title="Upper Band Line Style"
                  />
                  <TvLineWidthSelect
                    value={state.bollinger.upperLineWidth || 1}
                    onChange={(upperLineWidth) => updateBb({ upperLineWidth })}
                    title="Upper Band Line Thickness"
                  />
                </div>
              </div>

              {/* 3. Lower Band */}
              <div className="tv-tvstyle-row">
                <label className="tv-tvstyle-checklabel">
                  <input
                    type="checkbox"
                    checked={state.bollinger.showLower !== false}
                    onChange={(e) => updateBb({ showLower: e.target.checked })}
                  />
                  <span>Lower</span>
                </label>
                <div className="tv-tvstyle-controls">
                  <TvColorPickerButton
                    value={state.bollinger.lowerColor || state.bollinger.bandColor || "#2196f3"}
                    onChange={(lowerColor) => updateBb({ lowerColor })}
                    title="Lower Band Color"
                  />
                  <TvLineStyleSelect
                    value={state.bollinger.lowerLineStyle || "solid"}
                    onChange={(lowerLineStyle) => updateBb({ lowerLineStyle })}
                    title="Lower Band Line Style"
                  />
                  <TvLineWidthSelect
                    value={state.bollinger.lowerLineWidth || 1}
                    onChange={(lowerLineWidth) => updateBb({ lowerLineWidth })}
                    title="Lower Band Line Thickness"
                  />
                </div>
              </div>

              {/* 4. Background Fill */}
              <div className="tv-tvstyle-row">
                <label className="tv-tvstyle-checklabel">
                  <input
                    type="checkbox"
                    checked={state.bollinger.showFill}
                    onChange={(e) => updateBb({ showFill: e.target.checked })}
                  />
                  <span>Background Fill</span>
                </label>
                <div className="tv-tvstyle-controls">
                  {state.bollinger.showFill && (
                    <>
                      <TvColorPickerButton
                        value={state.bollinger.fillColor || "#2196f3"}
                        onChange={(fillColor) => updateBb({ fillColor })}
                        title="Fill Color"
                      />
                      <div className="tv-tvstyle-slider-wrap">
                        <input
                          type="range"
                          min={0.02}
                          max={0.35}
                          step={0.02}
                          value={state.bollinger.fillOpacity}
                          onChange={(e) => updateBb({ fillOpacity: Number(e.target.value) })}
                          title={`Fill Opacity: ${Math.round(state.bollinger.fillOpacity * 100)}%`}
                        />
                        <span className="tv-tvstyle-slider-val">
                          {Math.round(state.bollinger.fillOpacity * 100)}%
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Quick Preset Palette */}
              <div className="tv-tvstyle-palette-row">
                <span className="tv-tvstyle-palette-title">Color Palette:</span>
                <div className="tv-tvstyle-palette-chips">
                  {TV_SWATCHES.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      className="tv-palette-chip"
                      style={{ backgroundColor: swatch }}
                      title={`Select ${swatch}`}
                      onClick={() =>
                        updateBb({
                          bandColor: swatch,
                          upperColor: swatch,
                          lowerColor: swatch,
                          fillColor: swatch,
                        })
                      }
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {target.kind === "rsi" && tab === "inputs" && (
            <>
              <div className="tv-setting-field">
                <label>RSI Length</label>
                <input
                  type="number"
                  min={2}
                  max={200}
                  value={state.rsi.length}
                  onChange={(e) => updateRsi({ length: Math.max(2, Math.min(200, Number(e.target.value) || 14)) })}
                />
              </div>
              <div className="tv-setting-field">
                <label>Source</label>
                <select value={state.rsi.source} onChange={(e) => updateRsi({ source: e.target.value as PriceSource })}>
                  {SOURCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="tv-setting-field">
                <label>Smoothing MA Type</label>
                <select
                  value={state.rsi.maType}
                  onChange={(e) => updateRsi({ maType: e.target.value as "None" | "SMA" | "EMA" })}
                >
                  <option value="None">None</option>
                  <option value="SMA">SMA</option>
                  <option value="EMA">EMA</option>
                </select>
              </div>
              <div className="tv-setting-field">
                <label>MA Length</label>
                <input
                  type="number"
                  min={2}
                  max={100}
                  disabled={state.rsi.maType === "None"}
                  value={state.rsi.maLength}
                  onChange={(e) => updateRsi({ maLength: Math.max(2, Math.min(100, Number(e.target.value) || 14)) })}
                />
              </div>
            </>
          )}

          {target.kind === "rsi" && tab === "style" && (
            <div className="tv-tvstyle-list">
              {/* 1. RSI Line */}
              <div className="tv-tvstyle-row">
                <label className="tv-tvstyle-checklabel">
                  <input
                    type="checkbox"
                    checked={state.rsi.visible}
                    onChange={(e) => updateRsi({ visible: e.target.checked })}
                  />
                  <span>RSI</span>
                </label>
                <div className="tv-tvstyle-controls">
                  <TvColorPickerButton
                    value={state.rsi.color}
                    onChange={(color) => updateRsi({ color })}
                    title="RSI Line Color"
                  />
                  <TvLineStyleSelect
                    value={state.rsi.lineStyle || "solid"}
                    onChange={(lineStyle) => updateRsi({ lineStyle })}
                    title="RSI Line Style"
                  />
                  <TvLineWidthSelect
                    value={state.rsi.lineWidth || 2}
                    onChange={(lineWidth) => updateRsi({ lineWidth })}
                    title="RSI Line Thickness"
                  />
                </div>
              </div>

              {/* 2. RSI Upper Band (Default: 60) */}
              <div className="tv-tvstyle-row">
                <label className="tv-tvstyle-checklabel">
                  <input
                    type="checkbox"
                    checked={state.rsi.showUpper !== false}
                    onChange={(e) => updateRsi({ showUpper: e.target.checked })}
                  />
                  <span>RSI Upper Band</span>
                </label>
                <div className="tv-tvstyle-controls">
                  <TvColorPickerButton
                    value={state.rsi.upperColor || "#089981"}
                    onChange={(upperColor) => updateRsi({ upperColor })}
                    title="Upper Band Color"
                  />
                  <TvLineStyleSelect
                    value={state.rsi.upperLineStyle || "dashed"}
                    onChange={(upperLineStyle) => updateRsi({ upperLineStyle })}
                    title="Upper Band Line Style"
                  />
                  <input
                    type="number"
                    min={1}
                    max={99}
                    className="tv-tvstyle-num-input"
                    value={state.rsi.upperLevel}
                    onChange={(e) =>
                      updateRsi({ upperLevel: Math.max(1, Math.min(99, Number(e.target.value) || 60)) })
                    }
                    title="Upper Band Level (Default 60)"
                  />
                </div>
              </div>

              {/* 3. RSI Middle Band (Default: 50) */}
              <div className="tv-tvstyle-row">
                <label className="tv-tvstyle-checklabel">
                  <input
                    type="checkbox"
                    checked={state.rsi.showMiddle}
                    onChange={(e) => updateRsi({ showMiddle: e.target.checked })}
                  />
                  <span>RSI Middle Band</span>
                </label>
                <div className="tv-tvstyle-controls">
                  <TvColorPickerButton
                    value={state.rsi.middleColor || "#787b86"}
                    onChange={(middleColor) => updateRsi({ middleColor })}
                    title="Middle Band Color"
                  />
                  <TvLineStyleSelect
                    value={state.rsi.middleLineStyle || "dotted"}
                    onChange={(middleLineStyle) => updateRsi({ middleLineStyle })}
                    title="Middle Band Line Style"
                  />
                  <input
                    type="number"
                    min={1}
                    max={99}
                    className="tv-tvstyle-num-input"
                    value={state.rsi.middleLevel ?? 50}
                    onChange={(e) =>
                      updateRsi({ middleLevel: Math.max(1, Math.min(99, Number(e.target.value) || 50)) })
                    }
                    title="Middle Band Level (Default 50)"
                  />
                </div>
              </div>

              {/* 4. RSI Lower Band (Default: 40) */}
              <div className="tv-tvstyle-row">
                <label className="tv-tvstyle-checklabel">
                  <input
                    type="checkbox"
                    checked={state.rsi.showLower !== false}
                    onChange={(e) => updateRsi({ showLower: e.target.checked })}
                  />
                  <span>RSI Lower Band</span>
                </label>
                <div className="tv-tvstyle-controls">
                  <TvColorPickerButton
                    value={state.rsi.lowerColor || "#089981"}
                    onChange={(lowerColor) => updateRsi({ lowerColor })}
                    title="Lower Band Color"
                  />
                  <TvLineStyleSelect
                    value={state.rsi.lowerLineStyle || "dashed"}
                    onChange={(lowerLineStyle) => updateRsi({ lowerLineStyle })}
                    title="Lower Band Line Style"
                  />
                  <input
                    type="number"
                    min={1}
                    max={99}
                    className="tv-tvstyle-num-input"
                    value={state.rsi.lowerLevel}
                    onChange={(e) =>
                      updateRsi({ lowerLevel: Math.max(1, Math.min(99, Number(e.target.value) || 40)) })
                    }
                    title="Lower Band Level (Default 40)"
                  />
                </div>
              </div>

              {/* 5. RSI Background Fill */}
              <div className="tv-tvstyle-row">
                <label className="tv-tvstyle-checklabel">
                  <input
                    type="checkbox"
                    checked={state.rsi.showFill}
                    onChange={(e) => updateRsi({ showFill: e.target.checked })}
                  />
                  <span>RSI Background Fill</span>
                </label>
                <div className="tv-tvstyle-controls">
                  {state.rsi.showFill && (
                    <div className="tv-tvstyle-slider-wrap">
                      <input
                        type="range"
                        min={0.02}
                        max={0.25}
                        step={0.02}
                        value={state.rsi.fillOpacity ?? 0.06}
                        onChange={(e) => updateRsi({ fillOpacity: Number(e.target.value) })}
                        title={`Opacity: ${Math.round((state.rsi.fillOpacity ?? 0.06) * 100)}%`}
                      />
                      <span className="tv-tvstyle-slider-val">
                        {Math.round((state.rsi.fillOpacity ?? 0.06) * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Preset Palette */}
              <div className="tv-tvstyle-palette-row">
                <span className="tv-tvstyle-palette-title">Color Palette:</span>
                <div className="tv-tvstyle-palette-chips">
                  {TV_SWATCHES.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      className="tv-palette-chip"
                      style={{ backgroundColor: swatch }}
                      title={`Select ${swatch}`}
                      onClick={() => updateRsi({ upperColor: swatch, lowerColor: swatch })}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {target.kind === "volume" && tab === "inputs" && (
            <>
              <div className="tv-setting-field">
                <label>Color Based On</label>
                <select
                  value={state.volume.colorMode}
                  onChange={(e) => updateVol({ colorMode: e.target.value as "candle" | "prevClose" })}
                >
                  <option value="candle">Candle Direction (Close vs Open)</option>
                  <option value="prevClose">Previous Close</option>
                </select>
              </div>
              <div className="tv-setting-field">
                <label>Volume MA</label>
                <input
                  type="checkbox"
                  checked={state.volume.showMa}
                  onChange={(e) => updateVol({ showMa: e.target.checked })}
                />
              </div>
              <div className="tv-setting-field">
                <label>MA Length</label>
                <input
                  type="number"
                  min={2}
                  max={200}
                  disabled={!state.volume.showMa}
                  value={state.volume.maLength}
                  onChange={(e) => updateVol({ maLength: Math.max(2, Math.min(200, Number(e.target.value) || 20)) })}
                />
              </div>
            </>
          )}

          {target.kind === "volume" && tab === "style" && (
            <>
              <ColorPickerField
                label="Growing (Up) Color"
                value={state.volume.upColor}
                onChange={(upColor) => updateVol({ upColor })}
              />
              <ColorPickerField
                label="Falling (Down) Color"
                value={state.volume.downColor}
                onChange={(downColor) => updateVol({ downColor })}
              />
              {state.volume.showMa && (
                <ColorPickerField
                  label="Volume MA Color"
                  value={state.volume.maColor}
                  onChange={(maColor) => updateVol({ maColor })}
                />
              )}
              <div className="tv-setting-field">
                <label>Bar Opacity ({Math.round(state.volume.opacity * 100)}%)</label>
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={state.volume.opacity}
                  onChange={(e) => updateVol({ opacity: Number(e.target.value) })}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="tv-dialog-footer">
          <div className="tv-footer-left">
            <button type="button" className="tv-btn-ghost" onClick={handleReset}>
              <RotateCcw size={13} /> Defaults
            </button>
            <button type="button" className="tv-btn-ghost danger" onClick={handleRemove}>
              <Trash2 size={13} /> Remove
            </button>
          </div>
          <div className="tv-footer-right">
            <button type="button" className="tv-btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
            <button type="button" className="tv-btn-primary" onClick={handleConfirm}>
              Ok
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
