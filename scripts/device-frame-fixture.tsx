import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Stage } from "react-konva";
import { DeviceFrame } from "../src/devices/DeviceFrame";
import { DEVICE_PRESETS, toScreenDevice } from "../src/devices/catalog";
import { rotateDevice } from "../src/devices/frame";
import type { ScreenDevice } from "../src/devices/types";
import type { Widget } from "../src/project/schema";

const picker = document.querySelector<HTMLSelectElement>("#frame-preset");
const rotateButton = document.querySelector<HTMLButtonElement>("#rotate-frame");
const status = document.querySelector<HTMLElement>("#frame-status");
const stageContainer = document.querySelector<HTMLElement>("#frame-stage");
if (!picker || !rotateButton || !status || !stageContainer) {
  throw new Error("Device frame verification fixture is missing a required control.");
}

for (const preset of DEVICE_PRESETS) {
  const option = document.createElement("option");
  option.value = preset.id;
  option.textContent = preset.name;
  picker.append(option);
}

const warningWidget: Widget = {
  id: "safe-area-warning",
  type: "rectangle",
  x: 0,
  y: 0,
  width: 24,
  height: 18,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  zIndex: 0,
  style: {},
  props: {},
};

function VerificationApp() {
  const [device, setDevice] = useState<ScreenDevice>(() => toScreenDevice(DEVICE_PRESETS[0]));
  const preset = DEVICE_PRESETS.find((item) => item.id === device.presetId) ?? DEVICE_PRESETS[0];
  const scale = Math.min(
    Math.max(1, window.innerWidth - 48) / device.width,
    Math.max(1, window.innerHeight - 96) / device.height,
    1,
  );

  useEffect(() => {
    const selectPreset = (event: Event) => {
      const presetId = (event as CustomEvent<string>).detail;
      const selected = DEVICE_PRESETS.find((item) => item.id === presetId);
      if (!selected) throw new Error(`Unknown device preset: ${presetId}`);
      setDevice(toScreenDevice(selected));
    };
    const rotate = () => setDevice((current) => rotateDevice(current));
    window.addEventListener("deviceframepreset", selectPreset);
    window.addEventListener("deviceframerotate", rotate);
    return () => {
      window.removeEventListener("deviceframepreset", selectPreset);
      window.removeEventListener("deviceframerotate", rotate);
    };
  }, []);

  picker.value = preset.id;
  status.textContent = `${preset.name} · ${device.width} × ${device.height} · DPR ${window.devicePixelRatio}`;

  return (
    <Stage width={window.innerWidth} height={Math.max(1, window.innerHeight - 52)}>
      <DeviceFrame
        device={device}
        preset={preset}
        widgets={[warningWidget]}
        transform={{ x: 24, y: 20, scale }}
        visible
        showFrame
        showSafeArea
        statusBarTheme="dark"
        statusBarTimeMode="static"
        showBattery
        showSignal
      />
    </Stage>
  );
}

picker.addEventListener("change", () => {
  window.dispatchEvent(new CustomEvent("deviceframepreset", { detail: picker.value }));
});
rotateButton.addEventListener("click", () => {
  window.dispatchEvent(new CustomEvent("deviceframerotate"));
});

createRoot(stageContainer).render(<VerificationApp />);
