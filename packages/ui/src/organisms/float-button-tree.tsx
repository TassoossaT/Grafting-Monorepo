import {
  FloatingFocusManager,
  FloatingNode,
  FloatingPortal,
  FloatingTree,
  offset,
  safePolygon,
  useClick,
  useDismiss,
  useFloating,
  useFloatingNodeId,
  useFloatingParentNodeId,
  useFloatingTree,
  useHover,
  useInteractions,
} from "@floating-ui/react";
import { FloatButton as AntFloatButton } from "antd";
import { useEffect, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";

/** How a branch's own submenu opens. */
export type FloatButtonTreeTrigger = "click" | "hover";

/** How siblings under the same branch coordinate their open state. `"accordion"` closes any other open sibling when one opens; `"multiple"` lets them stay open together. */
export type FloatButtonTreeSiblingMode = "accordion" | "multiple";

/** Which side a branch's own submenu expands toward from its trigger. */
export type FloatButtonTreePlacement = "top" | "right" | "bottom" | "left";

/** A direct action -- the tree's equivalent of a leaf node. */
export interface FloatButtonTreeLeaf {
  /** Stable identity among its siblings. */
  readonly key: string;
  /** Caller-rendered icon content. Vendor-neutral -- this organism never ships its own icon set. */
  readonly icon: ReactNode;
  /** Tooltip and accessible name -- a float button shows no visible text label of its own. */
  readonly tooltip: string;
  /** Emphasis, e.g. to mark the currently-active leaf in a selector. */
  readonly tone?: "default" | "primary";
  /** Renders this leaf non-interactive. */
  readonly disabled?: boolean;
  /** Invoked when this leaf is activated. Closes the whole tree afterward, like choosing a menu action. */
  readonly onClick: () => void;
  /** Absent on a leaf -- its presence (not its value) is what distinguishes a {@link FloatButtonTreeBranch} from a leaf. */
  readonly children?: undefined;
}

/** A branch: its own floating trigger, revealing a nested list of further {@link FloatButtonTreeNode}s -- leaves, or further branches. */
export interface FloatButtonTreeBranch {
  /** Stable identity among its siblings. */
  readonly key: string;
  /** Caller-rendered icon content. Vendor-neutral -- this organism never ships its own icon set. */
  readonly icon: ReactNode;
  /** Tooltip and accessible name -- a float button shows no visible text label of its own. */
  readonly tooltip: string;
  /** Emphasis, e.g. to mark the currently-active branch in a selector. */
  readonly tone?: "default" | "primary";
  /** Renders this branch's own trigger non-interactive. */
  readonly disabled?: boolean;
  /** Absent on a branch -- a branch opens its `children`, it does not fire a direct action. */
  readonly onClick?: undefined;
  /** The nodes revealed when this branch opens, in display order. */
  readonly children: readonly FloatButtonTreeNode[];
  /** Overrides the tree-level default trigger for this branch's own submenu. */
  readonly trigger?: FloatButtonTreeTrigger;
  /** Overrides the tree-level default sibling behavior among this branch's own children. */
  readonly siblingMode?: FloatButtonTreeSiblingMode;
  /** Overrides the tree-level default expand direction for this branch's own submenu. */
  readonly placement?: FloatButtonTreePlacement;
}

/** One node of a {@link FloatButtonTree}: either a leaf action or a branch with its own nested children. */
export type FloatButtonTreeNode = FloatButtonTreeLeaf | FloatButtonTreeBranch;

/** Public inputs for a tree of floating-button groups -- a group whose items can themselves be groups. */
export interface FloatButtonTreeProps {
  /** The tree's single entry point. Always a branch: a tree with nothing to expand is just a `FloatButton`. */
  readonly root: FloatButtonTreeBranch;
  /** Default submenu trigger for every branch that does not set its own. @default "click" */
  readonly trigger?: FloatButtonTreeTrigger;
  /** Default sibling behavior for every branch that does not set its own. @default "accordion" */
  readonly siblingMode?: FloatButtonTreeSiblingMode;
  /** Default submenu expand direction for every branch that does not set its own. @default "right" */
  readonly placement?: FloatButtonTreePlacement;
  /** Outline for every button in the tree. @default "circle" */
  readonly shape?: "circle" | "square";
  /** Optional caller-owned class name for the tree's own root position wrapper. */
  readonly className?: string;
  /** Optional caller-owned inline style, e.g. to fix the tree's root to a corner of the screen. */
  readonly style?: CSSProperties;
}

function isBranch(node: FloatButtonTreeNode): node is FloatButtonTreeBranch {
  return node.children !== undefined;
}

function axisFor(placement: FloatButtonTreePlacement): "row" | "column" {
  return placement === "left" || placement === "right" ? "column" : "row";
}

// A branch announces its own opening on this event so siblings under the
// same parent can close themselves (accordion mode); a leaf click announces
// on this other event so every open branch in the whole tree closes, the
// way choosing a menu action closes the whole menu.
const BRANCH_OPEN_EVENT = "float-button-tree:branch-open";
const CLOSE_ALL_EVENT = "float-button-tree:close-all";

interface BranchViewProps {
  readonly node: FloatButtonTreeBranch;
  readonly defaultTrigger: FloatButtonTreeTrigger;
  readonly defaultSiblingMode: FloatButtonTreeSiblingMode;
  readonly defaultPlacement: FloatButtonTreePlacement;
  readonly shape: "circle" | "square";
}

function FloatButtonTreeBranchView(props: BranchViewProps): ReactElement {
  const [open, setOpen] = useState(false);
  const nodeId = useFloatingNodeId();
  const parentId = useFloatingParentNodeId();
  const tree = useFloatingTree();

  const triggerMode = props.node.trigger ?? props.defaultTrigger;
  const siblingMode = props.node.siblingMode ?? props.defaultSiblingMode;
  const placement = props.node.placement ?? props.defaultPlacement;

  const { refs, floatingStyles, context } = useFloating({
    nodeId,
    open,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(8)],
  });

  const click = useClick(context, { enabled: triggerMode === "click" });
  const hover = useHover(context, {
    enabled: triggerMode === "hover",
    handleClose: safePolygon({ blockPointerEvents: true }),
  });
  const dismiss = useDismiss(context, { bubbles: true });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, hover, dismiss]);

  useEffect(() => {
    if (open && tree !== null) tree.events.emit(BRANCH_OPEN_EVENT, { nodeId, parentId });
  }, [open, tree, nodeId, parentId]);

  useEffect(() => {
    if (tree === null) return;
    function onSiblingOpen(event: { nodeId: string; parentId: string | null }): void {
      if (event.nodeId === nodeId || event.parentId !== parentId) return;
      if (siblingMode === "accordion") setOpen(false);
    }
    function onCloseAll(): void {
      setOpen(false);
    }
    tree.events.on(BRANCH_OPEN_EVENT, onSiblingOpen);
    tree.events.on(CLOSE_ALL_EVENT, onCloseAll);
    return () => {
      tree.events.off(BRANCH_OPEN_EVENT, onSiblingOpen);
      tree.events.off(CLOSE_ALL_EVENT, onCloseAll);
    };
  }, [tree, nodeId, parentId, siblingMode]);

  return (
    <FloatingNode id={nodeId}>
      <span ref={refs.setReference} {...getReferenceProps()} style={{ display: "inline-flex" }}>
        <AntFloatButton
          icon={props.node.icon}
          tooltip={props.node.tooltip}
          type={props.node.tone ?? "default"}
          disabled={props.node.disabled}
          shape={props.shape}
          style={{ position: "static" }}
        />
      </span>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
            <div
              ref={refs.setFloating}
              style={{ ...floatingStyles, display: "flex", flexDirection: axisFor(placement), gap: "0.5rem" }}
              {...getFloatingProps()}
            >
              {props.node.children.map((child) =>
                isBranch(child) ? (
                  <FloatButtonTreeBranchView
                    key={child.key}
                    node={child}
                    defaultTrigger={props.defaultTrigger}
                    defaultSiblingMode={props.defaultSiblingMode}
                    defaultPlacement={props.defaultPlacement}
                    shape={props.shape}
                  />
                ) : (
                  <FloatButtonTreeLeafView key={child.key} node={child} shape={props.shape} />
                ),
              )}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </FloatingNode>
  );
}

function FloatButtonTreeLeafView(props: {
  readonly node: FloatButtonTreeLeaf;
  readonly shape: "circle" | "square";
}): ReactElement {
  const tree = useFloatingTree();
  return (
    <AntFloatButton
      icon={props.node.icon}
      tooltip={props.node.tooltip}
      type={props.node.tone ?? "default"}
      disabled={props.node.disabled}
      shape={props.shape}
      style={{ position: "static" }}
      onClick={() => {
        props.node.onClick();
        tree?.events.emit(CLOSE_ALL_EVENT);
      }}
    />
  );
}

/**
 * A tree of floating-button groups: a root trigger reveals a floating list
 * of items, any of which can itself be a branch with its own nested list
 * -- "a group of groups". Generic and product-agnostic: every node is
 * plain data (an action, or an icon/tooltip plus more nodes), nothing here
 * names a product concept.
 *
 * Built on `@floating-ui/react` (MIT, the maintained successor to Popper.js)
 * rather than hand-rolled, specifically for its `FloatingTree` primitive:
 * coordinating open/close state, dismissal, and positioning across an
 * arbitrarily nested set of floating elements is exactly the hard part a
 * library should own. The event-coordination pattern here (a branch
 * announces opening via `tree.events` so accordion siblings close, a leaf
 * click announces closing the whole tree) mirrors Floating UI's own
 * reference nested-menu implementation
 * (`packages/react/test/visual/components/Menu.tsx` in their monorepo),
 * simplified: no roving-tabindex list navigation or typeahead, since this
 * is a cluster of buttons, not a full ARIA menu widget.
 *
 * Every branch's trigger mode (`"click"` | `"hover"`) and sibling behavior
 * (`"accordion"` | `"multiple"`) default from this component's own props
 * but can be overridden per branch node, so one tree can mix e.g.
 * click-to-open categories with hover-to-open sub-items.
 *
 * @layer organism
 * @status stable
 */
export function FloatButtonTree(props: FloatButtonTreeProps): ReactElement {
  return (
    <div className={props.className} style={{ position: "absolute", ...props.style }}>
      <FloatingTree>
        <FloatButtonTreeBranchView
          node={props.root}
          defaultTrigger={props.trigger ?? "click"}
          defaultSiblingMode={props.siblingMode ?? "accordion"}
          defaultPlacement={props.placement ?? "right"}
          shape={props.shape ?? "circle"}
        />
      </FloatingTree>
    </div>
  );
}
