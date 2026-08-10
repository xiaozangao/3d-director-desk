import { getReleaseBlockers } from "../check-release-readiness.mjs";

it("allows only assets explicitly approved for redistribution", () => {
  expect(getReleaseBlockers({ assets: [{ path: "public/approved", redistributionStatus: "approved-for-redistribution" }] }))
    .toEqual([]);
});

it("returns every asset whose redistribution evidence is incomplete", () => {
  expect(getReleaseBlockers({
    assets: [
      { path: "public/unknown", redistributionStatus: "blocked-missing-license" },
      { path: "public/review", redistributionStatus: "blocked-license-review" },
    ],
  })).toEqual([
    "public/unknown: blocked-missing-license",
    "public/review: blocked-license-review",
  ]);
});
