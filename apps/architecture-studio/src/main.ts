import { renderGraphIr, type GraphIrCandidate } from "@grafting/graph-x6";
import graphData from "../../../docs/generated/grafting.graph.spike.json";
import "./style.css";

const container = document.querySelector<HTMLElement>("#graph");
const status = document.querySelector<HTMLElement>("#status");
const center = document.querySelector<HTMLButtonElement>("#center");
if (!container || !status || !center) throw new Error("Architecture Studio shell is incomplete");

const view = renderGraphIr(container, graphData as GraphIrCandidate);
center.addEventListener("click", () => view.center());
status.textContent = `${view.nodeCount} nodes · ${view.edgeCount} edges · source ${graphData.inputHash.slice(0, 12)}`;
status.dataset.status = "passed";
document.body.dataset.readonly = "true";
