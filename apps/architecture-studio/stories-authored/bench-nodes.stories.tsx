import { useEffect, useRef, type ReactElement } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CanvasNode, CanvasNodeViewDefinition } from "@grafting/ui";
import {
  BENCH_CONTROL_NODE_VIEW,
  BENCH_ELEMENT_NODE_VIEW,
  BENCH_VIEWPORT_NODE_VIEW,
  benchNodeSize,
  benchPorts,
  describeParams,
  viewForKind,
} from "../src/bench/bench-composition.ts";
import { defaultParamValues } from "../src/bench/node-kind.ts";
import { BENCH_NODE_KINDS, findNodeKind } from "../src/bench/registry.ts";

// Authored stories, kept out of `stories/` on purpose: `scripts/generate-stories.mjs`
// deletes that directory wholesale before regenerating it from the UI doc mesh.
// These exist so a node's own presentation can be designed on its own, at any
// size, without placing it on a canvas and wiring a graph first.

const VIEWS: Readonly<Record<string, CanvasNodeViewDefinition>> = {
  "bench.element": BENCH_ELEMENT_NODE_VIEW,
  "bench.control": BENCH_CONTROL_NODE_VIEW,
  "bench.viewport": BENCH_VIEWPORT_NODE_VIEW,
};

/** A rolling surface, so the viewport has something to draw without Wasm. */
function sampleHeightfield(width: number, height: number) {
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      values[y * width + x] = (Math.sin(x / 7) + Math.cos(y / 9) + 2) / 4;
    }
  }
  return { width, height, values };
}

interface NodeStageProps {
  /** Registered element to render. */
  readonly kindId: string;
  /** Rendered width; leave at zero to use the element's own. */
  readonly width: number;
  /** Rendered height; leave at zero to use the element's own. */
  readonly height: number;
  /** Badge the node carries. */
  readonly status: "idle" | "evaluated" | "reused" | "waiting" | "failed";
  /** Whether the node draws as selected. */
  readonly selected: boolean;
  /** Whether a viewport is given something to draw. */
  readonly withPreview: boolean;
}

/**
 * Mounts one node view on its own, at a size you choose.
 *
 * The canvas is not involved: a node view is a plain DOM mount, so it can be
 * designed here and dropped onto the surface unchanged.
 */
function NodeStage({ kindId, width, height, status, selected, withPreview }: NodeStageProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const kind = findNodeKind(kindId);
  const natural = benchNodeSize(kind);
  const box = { width: width > 0 ? width : natural.width, height: height > 0 ? height : natural.height };

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const view = VIEWS[viewForKind(kind)];
    if (view === undefined) return;
    const params = defaultParamValues(kind);
    const node: CanvasNode = {
      id: "story",
      view: view.id,
      x: 0,
      y: 0,
      width: box.width,
      height: box.height,
      ports: benchPorts(kind),
      data: {
        title: kind.title,
        summary: kind.category,
        tags: describeParams(kind, params),
        status,
        params: kind.params,
        values: params,
        preview: withPreview ? sampleHeightfield(64, 64) : null,
        onParamChange: (paramId: string, raw: unknown) => {
          // eslint-disable-next-line no-console -- the point of the story is to see the control emit.
          console.log("param change", paramId, raw);
        },
      },
    };
    const mounted = view.mount(host, { node, selected });
    return () => mounted.dispose();
  }, [kind, box.width, box.height, status, selected, withPreview]);

  return (
    <div style={{ padding: 24, background: "#f8fafc", display: "inline-block" }}>
      <div ref={hostRef} style={{ width: box.width, height: box.height, position: "relative" }} />
    </div>
  );
}

const meta: Meta<typeof NodeStage> = {
  title: "Bench/Node views",
  component: NodeStage,
  parameters: {
    docs: {
      description: {
        component:
          "One bench node rendered on its own, at any size. Use this to design a node's presentation before placing it on the canvas.",
      },
    },
  },
  argTypes: {
    kindId: {
      control: "select",
      options: BENCH_NODE_KINDS.map((kind) => kind.id),
      description: "Which registered element to render.",
    },
    width: { control: { type: "range", min: 0, max: 480, step: 8 }, description: "Zero uses the element's own width." },
    height: { control: { type: "range", min: 0, max: 480, step: 8 }, description: "Zero uses the element's own height." },
    status: {
      control: "select",
      options: ["idle", "evaluated", "reused", "waiting", "failed"],
      description: "Badge from the last evaluation pass.",
    },
    selected: { control: "boolean", description: "Whether the node draws as selected." },
    withPreview: { control: "boolean", description: "Gives a viewport something to draw." },
  },
  args: { kindId: "heightmap.perlin", width: 0, height: 0, status: "evaluated", selected: false, withPreview: true },
};

export default meta;
type Story = StoryObj<typeof NodeStage>;

/** A generating element, with one output and a port per parameter. */
export const Element: Story = {};

/** An element whose node view is itself a control. */
export const Control: Story = { args: { kindId: "control.number" } };

/** An element that draws the value reaching it. */
export const Viewport: Story = { args: { kindId: "output.viewport", withPreview: true } };

/** The same element with a size chosen by hand, for checking how it scales. */
export const Resized: Story = { args: { kindId: "terrain.discretize", width: 320, height: 240 } };
