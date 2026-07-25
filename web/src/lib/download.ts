/** ファイルダウンロードユーティリティ */

export function downloadText(
  filename: string,
  text: string,
  mime = "text/plain"
): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function cellsToGeoJson(
  cells: { geometry: unknown; [key: string]: unknown }[]
): string {
  return JSON.stringify(
    {
      type: "FeatureCollection",
      features: cells.map((c) => {
        const { geometry, ...properties } = c;
        delete (properties as Record<string, unknown>).childIds;
        return { type: "Feature", geometry, properties };
      }),
    },
    null,
    2
  );
}
