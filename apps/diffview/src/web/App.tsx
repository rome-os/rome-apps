import "./styles.css";
import { lazy, Suspense } from "react";
const Browser = lazy(() => import("./Browser"));
const Spike = lazy(() =>
  import("./Renderer").then((mod) => ({ default: mod.Spike })),
);
export default function App() {
  return (
    <Suspense fallback={null}>
      {new URLSearchParams(location.search).get("p0") === "1" ? (
        <Spike />
      ) : (
        <Browser />
      )}
    </Suspense>
  );
}
