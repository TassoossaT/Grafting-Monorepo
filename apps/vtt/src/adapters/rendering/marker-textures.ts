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

/**
 * A vertical elevation/height gizmo handle inspired by Tiny Glade direct 3D manipulation:
 * a vibrant pill/diamond with vertical elevation arrows.
 */
export function createHeightGizmoTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("height gizmo texture needs a 2D canvas context");

  context.clearRect(0, 0, 64, 64);

  // Outer badge
  context.fillStyle = "#50b0ff";
  context.strokeStyle = "#0f233a";
  context.lineWidth = 4;
  context.beginPath();
  context.arc(32, 32, 24, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  // Vertical arrow pointing up
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.moveTo(32, 14);
  context.lineTo(44, 28);
  context.lineTo(36, 28);
  context.lineTo(36, 42);
  context.lineTo(28, 42);
  context.lineTo(28, 28);
  context.lineTo(20, 28);
  context.closePath();
  context.fill();

  // Bottom small chevron
  context.beginPath();
  context.moveTo(26, 46);
  context.lineTo(32, 51);
  context.lineTo(38, 46);
  context.lineTo(38, 49);
  context.lineTo(32, 54);
  context.lineTo(26, 49);
  context.closePath();
  context.fill();

  return canvas;
}
