import { render, screen, waitFor } from "@testing-library/react";
import { createDefaultDirectorProject } from "../../store/directorStore";
import { ProjectHealthIndicator } from "../ProjectHealthIndicator";

it("shows when the project JSON is portable", () => {
  render(<ProjectHealthIndicator project={createDefaultDirectorProject()} />);

  expect(screen.getByRole("status", { name: "工程健康：JSON 可跨设备" })).toHaveTextContent("JSON 可跨设备");
});

it("shows how many browser-local assets require reimport", async () => {
  const project = createDefaultDirectorProject();
  project.assets.push({
    id: "local-model",
    kind: "prop",
    sourceType: "model",
    fileName: "prop.glb",
    url: "blob:http://localhost/prop",
    storageKey: "asset-prop",
  });

  render(<ProjectHealthIndicator
    project={project}
    storage={{ isAvailable: true, read: async () => ({ key: "asset-prop" }) }}
  />);

  const status = screen.getByRole("status", { name: "工程健康：含 1 个仅当前浏览器可用的本地素材" });
  expect(status).toHaveTextContent("1 个本地素材");
  expect(status).toHaveAttribute("title", expect.stringContaining("跨设备使用时需要重新导入"));
  await waitFor(() => expect(status).toHaveAttribute("data-health-state", "local-assets-present"));
});

it("escalates browser-local references whose binary is missing", async () => {
  const project = createDefaultDirectorProject();
  project.assets.push({
    id: "missing-model",
    kind: "prop",
    sourceType: "model",
    fileName: "missing.glb",
    url: "director-asset://local/missing-key",
    storageKey: "missing-key",
  });

  render(<ProjectHealthIndicator
    project={project}
    storage={{ isAvailable: true, read: async () => null }}
  />);

  await waitFor(() => expect(screen.getByRole("status", {
    name: "工程健康：缺失 1 个本地素材",
  })).toHaveTextContent("缺失 1 个素材"));
});
