import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
const root = resolve("dist/web");
createServer(async (req, res) => {
  try {
    if (req.url.split("?")[0] === "/") {
      res.setHeader("content-type", "text/html");
      res.end(
        `<html lang="en"><link rel="icon" href="data:,"><body style="margin:0"><div id="host"></div><script type="module">const r=document.querySelector('#host').attachShadow({mode:'open'});const css=await(await fetch('/manifest.json')).json();for(const f of css.styles??[]) {const s=document.createElement('style');s.textContent=await(await fetch('/'+f)).text();r.append(s)}const c=document.createElement('div');r.append(c);const mod=await import('/'+css.entry);await mod.mount(c,{appId:'diffview',shell:{locale:'en',theme:'light'},assetBase:'/',apiBase:'/api/apps/diffview'});</script></body></html>`,
      );
      return;
    }
    const path = resolve(root, "." + decodeURIComponent(req.url.split("?")[0]));
    if (!path.startsWith(root + "/")) throw 0;
    res.setHeader(
      "Content-Type",
      extname(path) === ".js"
        ? "text/javascript"
        : extname(path) === ".css"
          ? "text/css"
          : "application/json",
    );
    res.end(await readFile(path));
  } catch {
    res.statusCode = 404;
    res.end();
  }
}).listen(4179, "127.0.0.1");
