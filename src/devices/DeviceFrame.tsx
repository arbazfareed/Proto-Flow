import { useEffect, useState } from "react";
import { Circle, Group, Layer, Line, Rect, Text } from "react-konva";
import type { DevicePreset, ScreenDevice } from "./types";
import type { Widget } from "../project/schema";
import { getSafeAreaBounds, getWidgetsOutsideSafeArea } from "./frame";

interface DeviceFrameProps {
  device: ScreenDevice;
  preset?: DevicePreset;
  widgets: readonly Widget[];
  visible?: boolean;
  showFrame: boolean;
  showSafeArea: boolean;
  statusBarTheme: "light" | "dark";
  statusBarTimeMode: "static" | "real";
  showBattery: boolean;
  showSignal: boolean;
}

function clockLabel(): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function DeviceViewportLayer({
  device,
  preset,
  visible,
  showFrame,
  showSafeArea,
}: Pick<DeviceFrameProps, "device" | "preset" | "visible" | "showFrame" | "showSafeArea">) {
  const chrome = preset?.frameChrome;
  const bezel = showFrame ? chrome?.bezel ?? 0 : 0;
  const radius = showFrame ? chrome?.cornerRadius ?? 0 : 0;
  const watchRadius = chrome?.notch === "watch"
    ? Math.min(device.width, device.height) / 2
    : radius;
  const safeArea = getSafeAreaBounds(device);

  return (
    <Layer visible={visible} listening={false} perfectDrawEnabled={false}>
      {showFrame && bezel > 0 && (
        <Rect
          x={-bezel}
          y={-bezel}
          width={device.width + bezel * 2}
          height={device.height + bezel * 2}
          cornerRadius={watchRadius}
          fill="#111216"
          stroke="#555760"
          strokeWidth={Math.max(1, bezel / 5)}
          shadowColor="#000000"
          shadowBlur={Math.max(8, bezel)}
          shadowOpacity={0.35}
          shadowOffset={{ x: 0, y: 4 }}
          perfectDrawEnabled={false}
        />
      )}
      {showFrame && preset?.id.startsWith("macbook-") && (
        <Rect
          x={-bezel * 1.5}
          y={device.height + bezel - 2}
          width={device.width + bezel * 3}
          height={8}
          cornerRadius={[0, 0, 5, 5]}
          fill="#25262b"
          stroke="#555760"
          strokeWidth={1}
          perfectDrawEnabled={false}
        />
      )}
      <Rect
        x={0}
        y={0}
        width={device.width}
        height={device.height}
        cornerRadius={Math.max(0, watchRadius - bezel)}
        fill="#ffffff"
        stroke={showFrame ? "#777983" : "#555760"}
        strokeWidth={showFrame ? 1 : 2}
        perfectDrawEnabled={false}
      />
      {showSafeArea && (
        <Rect
          x={safeArea.x}
          y={safeArea.y}
          width={safeArea.width}
          height={safeArea.height}
          fill={device.insets.top + device.insets.bottom + device.insets.left + device.insets.right > 0
            ? "#35a987"
            : undefined}
          opacity={0.05}
          stroke="#42c9a1"
          strokeWidth={1}
          dash={[6, 5]}
          perfectDrawEnabled={false}
        />
      )}
    </Layer>
  );
}

function DeviceChromeLayer({
  device,
  preset,
  widgets,
  visible,
  showFrame,
  statusBarTheme,
  statusBarTimeMode,
  showBattery,
  showSignal,
}: Omit<DeviceFrameProps, "showSafeArea">) {
  const [time, setTime] = useState("9:41");
  const chrome = preset?.frameChrome;
  const bezel = chrome?.bezel ?? 0;
  const cornerRadius = chrome?.cornerRadius ?? 0;
  const notch = chrome?.notch ?? "none";
  const color = statusBarTheme === "light" ? "#f8f8fb" : "#222329";
  const outsideWidgets = getWidgetsOutsideSafeArea(widgets, device);
  const isBrowserFrame = showFrame && notch === "browser";
  const statusTop = Math.min(
    device.height - 18,
    Math.max(6, device.insets.top > 0 ? device.insets.top * 0.2 : 8),
  );

  useEffect(() => {
    if (statusBarTimeMode !== "real") return;
    const updateTime = () => setTime(clockLabel());
    updateTime();
    const timer = window.setInterval(updateTime, 30_000);
    return () => window.clearInterval(timer);
  }, [statusBarTimeMode]);

  return (
    <Layer visible={visible} listening={false} perfectDrawEnabled={false}>
      {showFrame && isBrowserFrame && (
        <Group>
          <Rect
            x={0}
            y={-30}
            width={device.width}
            height={30}
            cornerRadius={[cornerRadius, cornerRadius, 0, 0]}
            fill="#27282d"
            stroke="#595a63"
            strokeWidth={1}
            perfectDrawEnabled={false}
          />
          <Circle x={13} y={-15} radius={3} fill="#ef6a64" />
          <Circle x={24} y={-15} radius={3} fill="#e9bd54" />
          <Circle x={35} y={-15} radius={3} fill="#61c554" />
          <Rect
            x={device.width * 0.2}
            y={-23}
            width={device.width * 0.6}
            height={16}
            cornerRadius={5}
            fill="#17181c"
            perfectDrawEnabled={false}
          />
          <Text
            x={device.width * 0.2 + 10}
            y={-20}
            width={device.width * 0.6 - 20}
            height={12}
            text={preset?.name ?? "Preview"}
            fontSize={9}
            fill="#a8a9b1"
            ellipsis
            perfectDrawEnabled={false}
          />
        </Group>
      )}
      {showFrame && bezel > 0 && !isBrowserFrame && (
        <Rect
          x={0.5}
          y={0.5}
          width={device.width - 1}
          height={device.height - 1}
          cornerRadius={Math.max(0, cornerRadius - bezel)}
          stroke="#4e505a"
          strokeWidth={1}
          perfectDrawEnabled={false}
        />
      )}
      {showFrame && !isBrowserFrame && (
        <Group>
          {statusBarTheme === "light" && (
            <Rect
              x={0}
              y={0}
              width={device.width}
              height={Math.max(24, device.insets.top)}
              fill="#27282d"
              perfectDrawEnabled={false}
            />
          )}
          <Text
            x={14}
            y={statusTop}
            text={statusBarTimeMode === "static" ? "9:41" : time}
            fontSize={12}
            fontStyle="bold"
            fill={color}
            perfectDrawEnabled={false}
          />
          {showSignal && (
            <Group x={device.width - (showBattery ? 52 : 20)} y={statusTop + 4}>
              {[4, 7, 10, 13].map((height, index) => (
                <Rect
                  key={height}
                  x={index * 4}
                  y={13 - height}
                  width={2.5}
                  height={height}
                  cornerRadius={1}
                  fill={color}
                  perfectDrawEnabled={false}
                />
              ))}
            </Group>
          )}
          {showBattery && (
            <Group x={device.width - 31} y={statusTop + 4}>
              <Rect
                width={20}
                height={10}
                cornerRadius={2}
                stroke={color}
                strokeWidth={1.2}
                perfectDrawEnabled={false}
              />
              <Rect x={2} y={2} width={14} height={6} cornerRadius={1} fill={color} />
              <Rect x={20} y={3} width={2} height={4} cornerRadius={1} fill={color} />
            </Group>
          )}
          {notch === "dynamic-island" && (
            <Rect
              x={device.width / 2 - 54}
              y={8}
              width={108}
              height={28}
              cornerRadius={15}
              fill="#111216"
              perfectDrawEnabled={false}
            />
          )}
          {notch === "notch" && (
            <Rect
              x={device.width / 2 - 75}
              y={0}
              width={150}
              height={24}
              cornerRadius={[0, 0, 14, 14]}
              fill="#111216"
              perfectDrawEnabled={false}
            />
          )}
          {notch === "punch-hole" && (
            <Circle
              x={device.width / 2}
              y={14}
              radius={5}
              fill="#15161a"
              stroke="#464850"
              strokeWidth={1}
            />
          )}
          {device.insets.bottom > 0 && (
            <Rect
              x={device.width / 2 - Math.min(54, device.width / 7)}
              y={device.height - Math.max(12, device.insets.bottom / 2) - 3}
              width={Math.min(108, device.width / 3.5)}
              height={4}
              cornerRadius={2}
              fill={color}
              opacity={0.85}
              perfectDrawEnabled={false}
            />
          )}
        </Group>
      )}
      {showFrame && notch === "watch" && (
        <Circle
          x={device.width / 2}
          y={device.height / 2}
          radius={Math.min(device.width, device.height) / 2 - bezel}
          stroke="#565862"
          strokeWidth={1}
          perfectDrawEnabled={false}
        />
      )}
      {outsideWidgets.map((widget) => (
        <Rect
          key={`safe-warning-${widget.id}`}
          x={widget.x}
          y={widget.y}
          width={widget.width}
          height={widget.height}
          rotation={widget.rotation}
          stroke="#ed5959"
          strokeWidth={2}
          dash={[5, 4]}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
      {showFrame && notch !== "browser" && (
        <Line
          points={[0, device.height, device.width, device.height]}
          stroke="#777983"
          strokeWidth={1}
          listening={false}
        />
      )}
    </Layer>
  );
}

export function DeviceFrame({
  device,
  preset,
  widgets,
  visible,
  showFrame,
  showSafeArea,
  statusBarTheme,
  statusBarTimeMode,
  showBattery,
  showSignal,
}: DeviceFrameProps) {
  return (
    <>
      <DeviceViewportLayer
        device={device}
        preset={preset}
        visible={visible}
        showFrame={showFrame}
        showSafeArea={showSafeArea}
      />
      <DeviceChromeLayer
        device={device}
        preset={preset}
        widgets={widgets}
        visible={visible}
        showFrame={showFrame}
        statusBarTheme={statusBarTheme}
        statusBarTimeMode={statusBarTimeMode}
        showBattery={showBattery}
        showSignal={showSignal}
      />
    </>
  );
}
