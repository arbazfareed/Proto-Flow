export type DeviceCategory = "phone" | "tablet" | "laptop" | "desktop" | "watch";
export type DeviceOrientation = "portrait" | "landscape";
export type DeviceNotch = "none" | "notch" | "dynamic-island" | "punch-hole" | "watch" | "browser";

export interface DeviceInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface DeviceFrameChrome {
  bezel: number;
  cornerRadius: number;
  notch: DeviceNotch;
}

export interface DevicePreset {
  id: string;
  name: string;
  category: DeviceCategory;
  viewport: { width: number; height: number };
  dpr: number;
  insets: DeviceInsets;
  orientation: DeviceOrientation;
  frameChrome?: DeviceFrameChrome;
}

export interface ScreenDevice {
  presetId: string;
  width: number;
  height: number;
  dpr: number;
  insets: DeviceInsets;
}

export interface CustomDeviceInput extends ScreenDevice {
  presetId: "custom";
}
