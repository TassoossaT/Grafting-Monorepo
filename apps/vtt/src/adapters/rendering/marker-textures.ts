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

/** Draws a vertical pill handle with up/down arrows for adjusting node height. */
export function createNodeHeightHandleTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("node height handle texture needs a 2D canvas context");

  context.clearRect(0, 0, 96, 128);

  // Ivory rounded vertical pill
  context.fillStyle = "#fffff0";
  context.strokeStyle = "#0b1a17";
  context.lineWidth = 4;

  context.beginPath();
  context.arc(48, 40, 32, Math.PI, 0);
  context.arc(48, 88, 32, 0, Math.PI);
  context.closePath();
  context.fill();
  context.stroke();

  // Gold up/down arrows
  context.fillStyle = "#f2c94c";
  context.lineWidth = 3;

  // Up arrow
  context.beginPath();
  context.moveTo(48, 32);
  context.lineTo(34, 52);
  context.lineTo(62, 52);
  context.closePath();
  context.fill();
  context.stroke();

  // Down arrow
  context.beginPath();
  context.moveTo(48, 96);
  context.lineTo(34, 76);
  context.lineTo(62, 76);
  context.closePath();
  context.fill();
  context.stroke();

  return canvas;
}
