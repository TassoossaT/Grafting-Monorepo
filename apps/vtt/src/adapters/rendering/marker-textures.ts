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

  // Soft ambient drop shadow
  context.fillStyle = "rgba(40, 30, 20, 0.22)";
  context.beginPath();
  context.arc(32, 34, 16, 0, Math.PI * 2);
  context.fill();

  // Ivory/Cream badge body
  context.fillStyle = "#faf8f5";
  context.strokeStyle = "#2d2724";
  context.lineWidth = 2.5;
  context.beginPath();
  context.arc(32, 32, 16, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  // Inner warm amber center core
  context.fillStyle = "#f4b251";
  context.beginPath();
  context.arc(32, 32, 7, 0, Math.PI * 2);
  context.fill();

  return canvas;
}

/**
 * An edge height gizmo handle inspired by Tiny Glade direct 3D manipulation:
 * a tactile ivory rounded capsule sitting on wall edges with slender vertical double arrows.
 */
export function createHeightGizmoTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("height gizmo texture needs a 2D canvas context");

  context.clearRect(0, 0, 64, 64);

  // Soft tactile drop shadow
  context.fillStyle = "rgba(35, 25, 18, 0.25)";
  context.beginPath();
  context.roundRect(14, 10, 36, 48, 18);
  context.fill();

  // Warm ivory pill body
  context.fillStyle = "#faf8f5";
  context.strokeStyle = "#2d2724";
  context.lineWidth = 2.5;
  context.beginPath();
  context.roundRect(14, 8, 36, 48, 18);
  context.fill();
  context.stroke();

  // Slender top arrow pointing up (▲)
  context.fillStyle = "#2d2724";
  context.beginPath();
  context.moveTo(32, 16);
  context.lineTo(41, 27);
  context.lineTo(35, 27);
  context.lineTo(35, 31);
  context.lineTo(29, 31);
  context.lineTo(29, 27);
  context.lineTo(23, 27);
  context.closePath();
  context.fill();

  // Slender bottom arrow pointing down (▼)
  context.beginPath();
  context.moveTo(32, 48);
  context.lineTo(41, 37);
  context.lineTo(35, 37);
  context.lineTo(35, 33);
  context.lineTo(29, 33);
  context.lineTo(29, 37);
  context.lineTo(23, 37);
  context.closePath();
  context.fill();

  return canvas;
}

/**
 * A roof apex/pitch gizmo handle inspired by Tiny Glade:
 * a diamond pill sitting on the roof ridge with an upward pitch chevron.
 */
export function createRoofApexGizmoTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("roof apex gizmo texture needs a 2D canvas context");

  context.clearRect(0, 0, 64, 64);

  // Soft drop shadow
  context.fillStyle = "rgba(35, 25, 18, 0.25)";
  context.beginPath();
  context.roundRect(12, 12, 40, 40, 12);
  context.fill();

  // Warm ivory body
  context.fillStyle = "#faf8f5";
  context.strokeStyle = "#2d2724";
  context.lineWidth = 2.5;
  context.beginPath();
  context.roundRect(12, 10, 40, 40, 12);
  context.fill();
  context.stroke();

  // Roof pitch upward chevron (▲)
  context.strokeStyle = "#e07a5f";
  context.lineWidth = 4;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(20, 36);
  context.lineTo(32, 22);
  context.lineTo(44, 36);
  context.stroke();

  return canvas;
}

/**
 * A wall curvature / arc gizmo handle inspired by Tiny Glade:
 * a horizontal ivory capsule sitting at wall midpoints with horizontal arc arrows.
 */
export function createWallCurveGizmoTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("wall curve gizmo texture needs a 2D canvas context");

  context.clearRect(0, 0, 64, 64);

  // Soft drop shadow
  context.fillStyle = "rgba(35, 25, 18, 0.25)";
  context.beginPath();
  context.roundRect(8, 16, 48, 36, 18);
  context.fill();

  // Warm ivory pill body
  context.fillStyle = "#faf8f5";
  context.strokeStyle = "#2d2724";
  context.lineWidth = 2.5;
  context.beginPath();
  context.roundRect(8, 14, 48, 36, 18);
  context.fill();
  context.stroke();

  // Horizontal curved arc arrows (◄ ── ►)
  context.strokeStyle = "#2d2724";
  context.lineWidth = 3;
  context.lineCap = "round";
  context.beginPath();
  context.arc(32, 50, 24, Math.PI * 1.25, Math.PI * 1.75);
  context.stroke();

  // Left arrow head
  context.fillStyle = "#2d2724";
  context.beginPath();
  context.moveTo(17, 30);
  context.lineTo(24, 25);
  context.lineTo(24, 35);
  context.closePath();
  context.fill();

  // Right arrow head
  context.beginPath();
  context.moveTo(47, 30);
  context.lineTo(40, 25);
  context.lineTo(40, 35);
  context.closePath();
  context.fill();

  return canvas;
}
