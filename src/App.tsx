import AppShell from "./AppShell";
import "./App.css";
import { MeteredActionProvider } from "./wallet/meteredActions";

export default function App() {
  return (
    <MeteredActionProvider>
      <AppShell />
    </MeteredActionProvider>
  );
}
