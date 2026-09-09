import "./styles.css";
import { useEffect, useState } from "react";
import {
  getCurrentAppPath,
  subscribeToAppPath,
  type RomeAppBootstrap,
} from "@rome-os/app-web-sdk";
import { HomeView } from "./components/HomeView";
import { DetailView } from "./components/DetailView";

export default function App({ bootstrap: _bootstrap }: { bootstrap: RomeAppBootstrap }) {
  const [path, setPath] = useState<string>(() => getCurrentAppPath());

  useEffect(() => subscribeToAppPath((next) => setPath(next)), []);

  const detailId = path.replace(/^\/+/, "").split("/")[0].trim();

  return detailId ? <DetailView id={detailId} /> : <HomeView />;
}
