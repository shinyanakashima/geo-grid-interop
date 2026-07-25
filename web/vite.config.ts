import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages のようなサブパス配信（/geo-grid-interop/）でも動くよう
  // 相対パスでアセットを参照する。ルーティングはURLハッシュのみ使用。
  base: "./",
  plugins: [react()],
  worker: {
    format: "es",
  },
});
