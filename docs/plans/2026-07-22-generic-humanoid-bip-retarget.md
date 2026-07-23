# Generic Humanoid to BIP Retarget Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow generic humanoid FBX actions, including `左勾拳.fbx`, to import and play correctly on the built-in BIP mannequin with torso, clavicle, finger, toe, and root-motion handling.

**Architecture:** Add a pure generic-humanoid bone resolver beside the animation runtime, then use it from the existing local-rest retarget pipeline. Main limb tracks keep the established rest-pose correction; special chains receive explicit target mappings, and the two upper source-spine tracks are combined into the mannequin's single upper-spine joint. Compatibility is enabled only after the target mapping exists.

**Tech Stack:** React 18, TypeScript, Three.js animation tracks, Vitest.

---

### Task 1: Define and test the generic humanoid bone resolver

**Files:**
- Create: `src/editor/runtime/genericHumanoidRetarget.ts`
- Create: `src/editor/runtime/__tests__/genericHumanoidRetarget.test.ts`

1. Write failing tests for body, clavicle, neck, toe, and all finger aliases.
2. Add normalized source roles and built-in BIP target bone names.
3. Add deterministic source-node selection that prefers a structurally complete humanoid node when an FBX contains duplicate names.
4. Run the focused test file and confirm it passes.

### Task 2: Retarget complete generic animation tracks

**Files:**
- Modify: `src/editor/runtime/MixamoCharacterModel.tsx`
- Modify: `src/editor/runtime/__tests__/UE4MannequinModel.test.ts`

1. Write failing tests for shoulder-to-clavicle, finger, neck, and toe track targets.
2. Resolve generic source tracks before the broad semantic fallback.
3. Apply the existing local-rest quaternion correction to every resolved target.
4. Keep horizontal root motion anchored while preserving vertical hips motion.
5. Combine `Spine1` and `Spine2` deltas into the mannequin upper-spine track without duplicate bindings.
6. Run the runtime tests and confirm all target track names are unique.

### Task 3: Enable safe import compatibility

**Files:**
- Modify: `src/editor/panels/characterAnimationCompatibility.ts`
- Modify: `src/editor/panels/__tests__/CharacterPanel.test.tsx`

1. Write a failing compatibility test for built-in `bip` plus `generic-humanoid`.
2. Enable that pair while keeping unknown and unrelated profiles blocked.
3. Verify imported generic actions appear and can be selected for the built-in mannequin.

### Task 4: Verify against the supplied FBX and regressions

**Files:**
- Modify as required by test findings only.

1. Parse `E:/Downloads/左勾拳.fbx` with the same Three.js FBX loader used by the app.
2. Verify one valid clip, expected target coverage, no duplicate target tracks, and preserved duration.
3. Run animation inspection, character panel, Kimodo, and runtime test suites.
4. Run the production build and `git diff --check`.
