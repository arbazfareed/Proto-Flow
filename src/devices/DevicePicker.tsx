import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  Laptop,
  Monitor,
  MoveDiagonal,
  Search,
  Smartphone,
  Tablet,
  Watch,
  X,
} from "lucide-react";
import { DEVICE_CATEGORIES, DEVICE_PRESETS, findDevicePreset, toScreenDevice } from "./catalog";
import type { DeviceCategory, DevicePreset, ScreenDevice } from "./types";

const CATEGORY_LABELS: Record<DeviceCategory, string> = {
  phone: "Phones",
  tablet: "Tablets",
  laptop: "Laptops",
  desktop: "Desktops",
  watch: "Watches",
};

const RECENTS_KEY = "protoflow:recent-device-presets";

function categoryIcon(category: DeviceCategory) {
  if (category === "phone") return Smartphone;
  if (category === "tablet") return Tablet;
  if (category === "laptop") return Laptop;
  if (category === "desktop") return Monitor;
  return Watch;
}

function readRecentIds(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return [];
    return value.filter((id) => findDevicePreset(id)).slice(0, 5);
  } catch (error) {
    console.error("Could not read recently used device presets.", error);
    return [];
  }
}

function rememberPreset(device: DevicePreset): void {
  try {
    const recent = [device.id, ...readRecentIds().filter((id) => id !== device.id)].slice(0, 5);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recent));
  } catch (error) {
    console.error("Could not save the recently used device preset.", error);
  }
}

interface DevicePickerProps {
  mode: "create" | "change";
  open: boolean;
  currentDevice?: ScreenDevice;
  onClose: () => void;
  onCreate: (device: ScreenDevice) => void;
  onChange: (device: ScreenDevice, scaleWidgets: boolean) => void;
}

export function DevicePicker({
  mode,
  open,
  currentDevice,
  onClose,
  onCreate,
  onChange,
}: DevicePickerProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<DeviceCategory | "all">("all");
  const [customOpen, setCustomOpen] = useState(false);
  const [customDevice, setCustomDevice] = useState({
    width: "1440",
    height: "900",
    dpr: "1",
    top: "0",
    bottom: "0",
    left: "0",
    right: "0",
  });
  const [pendingDevice, setPendingDevice] = useState<ScreenDevice | null>(null);
  const recentPresets = useMemo(() => readRecentIds()
    .map((id) => findDevicePreset(id))
    .filter((device): device is DevicePreset => Boolean(device)), [open]);
  const normalizedSearch = search.trim().toLowerCase();
  const invalidCustomInsets =
    Number(customDevice.left) + Number(customDevice.right) >= Number(customDevice.width) ||
    Number(customDevice.top) + Number(customDevice.bottom) >= Number(customDevice.height);

  const filteredDevices = useMemo(
    () =>
      DEVICE_PRESETS.filter((device) => {
        const matchesCategory = category === "all" || device.category === category;
        const matchesSearch =
          !normalizedSearch ||
          `${device.name} ${device.id} ${device.category} ${device.viewport.width}x${device.viewport.height}`
            .toLowerCase()
            .includes(normalizedSearch);
        return matchesCategory && matchesSearch;
      }),
    [category, normalizedSearch],
  );

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setCategory("all");
    setCustomOpen(false);
    setPendingDevice(null);
    if (currentDevice?.presetId === "custom") {
      setCustomDevice({
        width: String(currentDevice.width),
        height: String(currentDevice.height),
        dpr: String(currentDevice.dpr),
        top: String(currentDevice.insets.top),
        bottom: String(currentDevice.insets.bottom),
        left: String(currentDevice.insets.left),
        right: String(currentDevice.insets.right),
      });
    }
  }, [open, currentDevice?.presetId]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (pendingDevice) setPendingDevice(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose, pendingDevice]);

  if (!open) return null;

  const choosePreset = (preset: DevicePreset) => {
    rememberPreset(preset);
    const device = toScreenDevice(preset);
    if (mode === "create") onCreate(device);
    else setPendingDevice(device);
  };

  const chooseCustom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const device: ScreenDevice = {
      presetId: "custom",
      width: Number(customDevice.width),
      height: Number(customDevice.height),
      dpr: Number(customDevice.dpr),
      insets: {
        top: Number(customDevice.top),
        bottom: Number(customDevice.bottom),
        left: Number(customDevice.left),
        right: Number(customDevice.right),
      },
    };
    if (mode === "create") onCreate(device);
    else setPendingDevice(device);
  };

  const getPresetLabel = (device: ScreenDevice) =>
    device.presetId === "custom"
      ? "Custom size"
      : findDevicePreset(device.presetId)?.name ?? device.presetId;

  const finishChange = (scaleWidgets: boolean) => {
    if (!pendingDevice) return;
    onChange(pendingDevice, scaleWidgets);
    setPendingDevice(null);
  };

  return (
    <div
      className="screen-picker-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pendingDevice) onClose();
      }}
    >
      <section
        className="screen-picker device-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="screen-picker-title"
      >
        <div className="screen-picker-heading">
          <div>
            <span className="inspector-overline">{mode === "create" ? "NEW SCREEN" : "SCREEN SETTINGS"}</span>
            <h2 id="screen-picker-title">{mode === "create" ? "Choose a device" : "Change device"}</h2>
          </div>
          <button className="icon-button small-icon" aria-label="Close device picker" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="device-picker-search">
          <Search size={15} aria-hidden="true" />
          <input
            aria-label="Search devices"
            placeholder="Search iPhone, desktop…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="device-category-tabs" role="group" aria-label="Filter device category">
          <button
            className={category === "all" ? "is-selected" : ""}
            aria-pressed={category === "all"}
            onClick={() => setCategory("all")}
          >
            All
          </button>
          {DEVICE_CATEGORIES.map((item) => (
            <button
              className={category === item ? "is-selected" : ""}
              aria-pressed={category === item}
              key={item}
              onClick={() => setCategory(item)}
            >
              {CATEGORY_LABELS[item]}
            </button>
          ))}
        </div>
        <div className="device-picker-list">
          {mode === "create" && recentPresets.length > 0 && !normalizedSearch && category === "all" && (
            <section className="device-picker-group">
              <h3>Recently used</h3>
              <div className="device-picker-grid">
                {recentPresets.map((device) => (
                <DeviceCard
                  key={`recent-${device.id}`}
                  device={device}
                  selected={currentDevice?.presetId === device.id}
                  onSelect={choosePreset}
                />
                ))}
              </div>
            </section>
          )}
          {DEVICE_CATEGORIES.map((item) => {
            const devices = filteredDevices.filter((device) => device.category === item);
            if (devices.length === 0) return null;
            return (
              <section className="device-picker-group" key={item}>
                <h3>{CATEGORY_LABELS[item]}</h3>
                <div className="device-picker-grid">
                  {devices.map((device) => (
                    <DeviceCard
                      key={device.id}
                      device={device}
                      selected={currentDevice?.presetId === device.id}
                      onSelect={choosePreset}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {filteredDevices.length === 0 && (
            <p className="device-picker-empty">No devices match this search.</p>
          )}
        </div>
        <form className="custom-device-form" onSubmit={chooseCustom}>
          <button
            className="custom-device-toggle"
            type="button"
            aria-expanded={customOpen}
            onClick={() => setCustomOpen((value) => !value)}
          >
            <span>Custom size</span>
            <span>{customOpen ? "−" : "+"}</span>
          </button>
          {customOpen && (
            <>
              <div className="custom-device-fields">
                {([
                  ["width", "Width"],
                  ["height", "Height"],
                  ["dpr", "DPR"],
                  ["top", "Safe top"],
                  ["bottom", "Safe bottom"],
                  ["left", "Safe left"],
                  ["right", "Safe right"],
                ] as const).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      type="number"
                      min={key === "width" || key === "height" ? 1 : key === "dpr" ? 0.25 : 0}
                      max={key === "width" || key === "height" ? 16384 : key === "dpr" ? 8 : 16384}
                      step={key === "dpr" ? 0.25 : 1}
                      required
                      value={customDevice[key]}
                      onChange={(event) =>
                        setCustomDevice((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              {invalidCustomInsets && (
                <p className="device-validation-error" role="alert">
                  Safe-area insets must fit within the viewport dimensions.
                </p>
              )}
              <button
                className="button button-primary custom-device-submit"
                type="submit"
                disabled={invalidCustomInsets}
              >
                Use custom size
              </button>
            </>
          )}
        </form>
      </section>

      {pendingDevice && (
        <div className="screen-picker-backdrop device-change-backdrop" role="presentation">
          <section className="screen-picker device-change-warning" role="alertdialog" aria-modal="true" aria-labelledby="device-change-title">
            <div className="screen-picker-heading">
              <div>
                <span className="inspector-overline">LAYOUT CHANGE</span>
                <h2 id="device-change-title">Change screen device?</h2>
              </div>
              <button className="icon-button small-icon" aria-label="Cancel device change" onClick={() => setPendingDevice(null)}>
                <X size={15} />
              </button>
            </div>
            <p>
              Changing to <strong>{getPresetLabel(pendingDevice)}</strong> ({pendingDevice.width} × {pendingDevice.height}) may shift existing widgets.
            </p>
            <p>Choose how to handle the current layout:</p>
            <button className="screen-picker-option" onClick={() => finishChange(true)}>
              <span className="screen-picker-icon"><MoveDiagonal size={16} /></span>
              <span><strong>Scale widgets proportionally</strong><small>Resize and reposition to fit the new viewport</small></span>
            </button>
            <button className="screen-picker-option keep-absolute-option" onClick={() => finishChange(false)}>
              <span className="screen-picker-icon"><Monitor size={16} /></span>
              <span><strong>Keep absolute positions</strong><small>Keep existing widget coordinates and dimensions</small></span>
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function DeviceCard({
  device,
  selected,
  onSelect,
}: {
  device: DevicePreset;
  selected: boolean;
  onSelect: (device: DevicePreset) => void;
}) {
  const Icon = categoryIcon(device.category);
  const portrait = device.viewport.height >= device.viewport.width;
  return (
    <button
      className={`device-card${selected ? " is-current" : ""}`}
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(device)}
    >
      <span className={`device-thumbnail device-${device.category}${portrait ? " is-portrait" : ""}`}>
        <Icon size={18} aria-hidden="true" />
        {device.frameChrome?.notch !== "none" && device.frameChrome && (
          <span className={`device-thumbnail-notch notch-${device.frameChrome.notch}`} />
        )}
      </span>
      <span className="device-card-copy">
        <strong>{device.name}</strong>
        <small>{device.viewport.width} × {device.viewport.height} · {device.dpr}×</small>
      </span>
    </button>
  );
}
