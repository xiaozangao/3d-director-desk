import { act, renderHook, waitFor } from "@testing-library/react";
import { useResolvedLocalAssetUrl } from "../useResolvedLocalAssetUrl";
import { localAssetBinaryStorage } from "../localAssetBinaryStorage";
import type { LocalAssetBinaryRecord } from "../localAssetBinaryStorage";

vi.mock("../localAssetBinaryStorage", () => ({
  getStoredAssetKey: vi.fn(() => null),
  localAssetBinaryStorage: {
    read: vi.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

it("does not expose the previous Blob URL while another stored asset is resolving", async () => {
  const firstRead = deferred<LocalAssetBinaryRecord | null>();
  const secondRead = deferred<LocalAssetBinaryRecord | null>();
  vi.mocked(localAssetBinaryStorage.read).mockImplementation((key) => (
    key === "asset-a" ? firstRead.promise : secondRead.promise
  ));
  const createObjectURL = vi.spyOn(URL, "createObjectURL")
    .mockReturnValueOnce("blob:asset-a")
    .mockReturnValueOnce("blob:asset-b");
  const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

  const { result, rerender, unmount } = renderHook(
    ({ asset }) => useResolvedLocalAssetUrl(asset),
    { initialProps: { asset: { url: "stored:a", storageKey: "asset-a" } as { url: string; storageKey?: string } | undefined } }
  );

  await act(async () => firstRead.resolve({
    key: "asset-a",
    blob: new Blob(["a"]),
    fileName: "a.fbx",
    mimeType: "application/octet-stream",
    byteLength: 1,
    updatedAt: 1,
  }));
  await waitFor(() => expect(result.current).toBe("blob:asset-a"));

  rerender({ asset: { url: "stored:b", storageKey: "asset-b" } });
  expect(result.current).toBeUndefined();

  await act(async () => secondRead.resolve({
    key: "asset-b",
    blob: new Blob(["b"]),
    fileName: "b.fbx",
    mimeType: "application/octet-stream",
    byteLength: 1,
    updatedAt: 2,
  }));
  await waitFor(() => expect(result.current).toBe("blob:asset-b"));

  unmount();
  expect(createObjectURL).toHaveBeenCalledTimes(2);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:asset-a");
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:asset-b");
});
