import { useEffect, useState } from "react";
import { getStoredAssetKey, localAssetBinaryStorage } from "./localAssetBinaryStorage";

export function useResolvedLocalAssetUrl(asset: { url: string; storageKey?: string } | undefined) {
  const storageKey = asset?.storageKey ?? (asset ? getStoredAssetKey(asset.url) : null);
  const directUrl = asset && !storageKey ? asset.url : undefined;
  const assetKey = storageKey ?? directUrl ?? null;
  const [resolved, setResolved] = useState<{ key: string | null; url?: string }>(() => ({
    key: assetKey,
    url: directUrl,
  }));

  useEffect(() => {
    setResolved({ key: assetKey, url: directUrl });
    if (!storageKey) return;

    let disposed = false;
    let objectUrl: string | null = null;
    void localAssetBinaryStorage.read(storageKey)
      .then((record) => {
        if (!record || disposed) return;
        objectUrl = URL.createObjectURL(record.blob);
        setResolved({ key: assetKey, url: objectUrl });
      })
      .catch(() => {
        if (!disposed) setResolved({ key: assetKey, url: undefined });
      });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetKey, directUrl, storageKey]);

  return resolved && typeof resolved === "object" && resolved.key === assetKey
    ? resolved.url
    : directUrl;
}
