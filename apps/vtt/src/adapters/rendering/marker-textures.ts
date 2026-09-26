/** Draws the sprite texture for a placed token marker: a filled circle with a small pointer tail. */
export function createMarkerTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("token marker texture needs a 2D canvas context");

  context.clearRect(0, 0, 128, 128);
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(64, 58, 47, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.72)";
  context.beginPath();
  context.moveTo(42, 95);
  context.lineTo(86, 95);
  context.lineTo(64, 123);
  context.closePath();
  context.fill();
  return canvas;
}

/** A small ring-dot, visually distinct from the token marker -- an editable construction-node handle, not a placed token. */
export function createNodeHandleTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("node handle texture needs a 2D canvas context");

  context.clearRect(0, 0, 64, 64);
  context.strokeStyle = "#0b1a17";
  context.lineWidth = 4;
  context.fillStyle = "#f2c94c";
  context.beginPath();
  context.arc(32, 32, 22, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  return canvas;
}


/** In-scene road branching affordance, distinct from a movable anchor. */
export function createRoadBranchTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("road action needs a 2D canvas context");
  context.fillStyle = "#167d52";
  context.strokeStyle = "#ffffff";
  context.lineWidth = 4;
  context.beginPath(); context.arc(32, 32, 27, 0, Math.PI * 2); context.fill(); context.stroke();
  context.lineWidth = 6;
  context.beginPath(); context.moveTo(18, 32); context.lineTo(46, 32);
  context.moveTo(32, 18); context.lineTo(32, 46); context.stroke();
  return canvas;
}

/** A disc in `fill`, outlined, with `draw` painting its white symbol on top. */
function glyphDisc(fill: string, draw: (context: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("handle glyph texture needs a 2D canvas context");
  context.fillStyle = fill;
  context.strokeStyle = "#0b1a17";
  context.lineWidth = 3;
  context.beginPath(); context.arc(32, 32, 28, 0, Math.PI * 2); context.fill(); context.stroke();
  context.fillStyle = context.strokeStyle = "#ffffff";
  context.lineWidth = 5;
  context.lineCap = "round";
  context.lineJoin = "round";
  draw(context);
  return canvas;
}

/** A filled arrowhead at (`x`, `y`) pointing along `angle`. */
function arrowhead(context: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
  context.beginPath();
  context.moveTo(x + Math.cos(angle) * 9, y + Math.sin(angle) * 9);
  context.lineTo(x + Math.cos(angle + 2.4) * 8, y + Math.sin(angle + 2.4) * 8);
  context.lineTo(x + Math.cos(angle - 2.4) * 8, y + Math.sin(angle - 2.4) * 8);
  context.closePath();
  context.fill();
}

/** Moves a whole structure: arrows out in four directions. */
export function createMoveHandleTexture(): HTMLCanvasElement {
  return glyphDisc("#2f6fde", (context) => {
    context.beginPath(); context.moveTo(14, 32); context.lineTo(50, 32); context.moveTo(32, 14); context.lineTo(32, 50); context.stroke();
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) arrowhead(context, 32 + Math.cos(angle) * 17, 32 + Math.sin(angle) * 17, angle);
  });
}

/** Sets a height: a double arrow up and down. */
export function createHeightHandleTexture(): HTMLCanvasElement {
  return glyphDisc("#1f9d62", (context) => {
    context.beginPath(); context.moveTo(32, 17); context.lineTo(32, 47); context.stroke();
    arrowhead(context, 32, 15, -Math.PI / 2);
    arrowhead(context, 32, 49, Math.PI / 2);
  });
}

/** Turns something round: a circular arrow. */
export function createTurnsHandleTexture(): HTMLCanvasElement {
  return glyphDisc("#e07a1f", (context) => {
    context.beginPath(); context.arc(32, 32, 14, -Math.PI * 0.35, Math.PI * 1.35); context.stroke();
    const end = Math.PI * 1.35;
    arrowhead(context, 32 + Math.cos(end) * 14, 32 + Math.sin(end) * 14, end + Math.PI / 2);
  });
}

/** Turns a whole structure round: two arrows chasing each other round a circle. */
export function createRotateHandleTexture(): HTMLCanvasElement {
  return glyphDisc("#8b5cf6", (context) => {
    for (const from of [0, Math.PI]) {
      const to = from + Math.PI * 0.72;
      context.beginPath(); context.arc(32, 32, 15, from + 0.25, to); context.stroke();
      arrowhead(context, 32 + Math.cos(to) * 15, 32 + Math.sin(to) * 15, to + Math.PI / 2);
    }
  });
}

/** A span's midpoint: a small diamond, lighter than a point, so it reads as "in between". */
export function createMidpointHandleTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("midpoint handle texture needs a 2D canvas context");
  context.fillStyle = "#fdf3c7";
  context.strokeStyle = "#0b1a17";
  context.lineWidth = 4;
  context.beginPath(); context.moveTo(32, 12); context.lineTo(52, 32); context.lineTo(32, 52); context.lineTo(12, 32); context.closePath();
  context.fill(); context.stroke();
  return canvas;
}
