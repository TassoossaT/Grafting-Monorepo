# Procedural Road Network Generation and Industry Patterns

Procedural road network generation in game engines and simulation platforms relies on a combination of graph-based topology generation, parametric curve evaluation, offset geometry mathematics, dynamic intersection meshing, and artifact mitigation algorithms. Representing multi-lane road networks requires solving fundamental geometric challenges—most notably the non-polynomial nature of parallel Bézier offset curves, cusp formation under tight radii of curvature, and topologic junction resolution across standard toolchains including Unreal Engine, Unity, Blender, Esri CityEngine, and ASAM OpenDRIVE.

## 1. Graph Topology and Road Network Generation

* **Graph-Based Infrastructure Core:** Road networks are modeled fundamentally as directional or bidirectional spatial graphs \(G = (V, E)\), where vertices \(V\) represent intersections, dead-ends, or junctions, and edges \(E\) represent road segments containing underlying parametric spline centerlines.
* **Procedural Synthesis Paradigms:**
  * **L-Systems & Extended Grammars:** Pioneered by Parish and Müller (2001), extended L-systems generate street graphs using procedural rules conditioned on density maps, terrain heightmaps, and water boundaries.
  * **Tensor Fields:** Vector and tensor fields guide hyper-streamlines to generate grid-like, radial, or organic road layouts while conforming smoothly to topologic constraints.
* **ASAM OpenDRIVE Reference Frame:**
  * Uses a curvilinear coordinate system \((s, t)\), where \(s\) is the arc length along a central reference line and \(t\) is the lateral displacement (lane offset).
  * Reference lines utilize piecewise continuous geometric primitives: straight lines, circular arcs, cubic polynomials (`paramPoly3`), and clothoid spirals (Euler spirals) to enforce continuous curvature transitions.
* **Esri CityEngine Graph Engine:**
  * Derives street networks procedurally from vector data or graph algorithms, automatically classifying nodes based on valence (number of connected street edges) into dynamic shapes such as `Junction`, `Crossing`, `Roundabout`, and `Joint`.

## 2. Bézier Ribbon Offset Algorithms and Parallel Curve Mathematics

* **Mathematical Nature of Curve Offsetting:**
  * Given a 2D parametric Bézier curve \(C(t)\), the analytical offset curve at distance \(r\) is defined as \(C_r(t) = C(t) + r \cdot N(t)\), where \(N(t)\) is the unit normal vector.
  * The offset of a polynomial Bézier curve is generally algebraic and non-polynomial due to the square root term in the unit normal vector \(N(t) = \frac{(-C'_y(t), C'_x(t))}{\|C'(t)\|}\). Consequently, exact offset curves cannot be represented as standard Bézier or B-spline curves of the same degree.
* **Offset Approximation Techniques:**
  * **Tiller-Hanson Algorithm:** Offsets the control polygon vectors directly perpendicular to each polygon leg. While computationally lightweight, it introduces geometric distortion in high-curvature regions and does not guarantee strict distance accuracy.
  * **Subdivision & Control Polygon Refinement:** Subdivides the parent Bézier curve (e.g., via de Casteljau's algorithm) at points of max curvature until each sub-segment's Tiller-Hanson offset control polygon stays within a designated error tolerance \(\epsilon\).
  * **Arc-Length Parameterization & Numerical Fitting:** Samples exact points on the true mathematical offset \(C_r(s)\) using Gauss-Legendre quadrature for arc-length parameterization, then fits a new cubic Bézier segment via least-squares or Hermite interpolation.
* **Parallel Ribbon Mesh Construction:**
  * Generates parallel lanes and sidewalks by evaluating discrete point sequences along left and right lateral offsets \(t_{\text{left}}(s)\) and \(t_{\text{right}}(s)\).
  * Computes smooth frame orienting vectors along the spline (using Rotation Minimizing Frames / Bishop Frames to avoid twisting) to construct quad-strip or triangle-strip ribbon meshes.

## 3. Cusp Mitigation and Self-Intersection Removal

* **Cusp Formation Conditions:**
  * A cusp occurs when the offset distance \(r\) equals or exceeds the local radius of curvature \(\rho(t) = \frac{1}{\kappa(t)}\), where \(\kappa(t)\) is the signed scalar curvature of the reference curve.
  * At \(\kappa(t) \cdot r = -1\), the velocity vector of the offset curve drops to zero (\(C'_r(t) = 0\)), causing the tangent vector to invert sharply and creating a self-intersecting loop (swallowtail singularity).
* **Self-Intersection Detection and Trimming:**
  * **Local Loop Detection:** Identifies parameter pairs \((t_1, t_2)\) where \(C_r(t_1) = C_r(t_2)\). In discretized polyline ribbon representations, line segment sweep-line algorithms (Bentley-Ottmann) locate self-intersection points efficiently.
  * **Loop Trimming & Vertex Collapse:** Clips the self-intersecting loop between \(t_1\) and \(t_2\), collapsing the inner boundary geometry to the intersection vertex or inserting a smooth fillet.
* **Straight Skeleton Buffering:**
  * Employs the straight skeleton algorithm (Aichholzer et al.) to compute variable-width offset polygon buffers.
  * Shrinks/grows polygon boundaries at constant propagation speeds along angular bisectors, naturally handling self-intersections without generating degenerate internal loops or overlapping quad strips.
* **Curvature-Driven Transition Smoothing:**
  * **Clothoid Insertion:** Integrates clothoid (Euler spiral) transitions where curvature changes linearly (\(\kappa(s) = a \cdot s\)). This prevents infinite curvature spikes, eliminating cusps along lane boundaries in modern CAD and autonomous vehicle simulation toolchains (OpenDRIVE).

## 4. Procedural Intersection and Junction Meshing

* **Junction Boundary Polygon Construction:**
  * Calculates intersection boundaries by trimming incoming road ribbon edges at calculated stop-line offsets based on road widths, incoming angles, and turning radii.
  * Extrudes center lines into the intersection area and clips them using ray-plane or line-line intersection tests between adjacent road boundaries.
* **Corner Fillet and Miter Geometry:**
  * **Arc Corner Style:** Generates smooth circular or Bézier fillet curves connecting adjacent curb lines to accommodate vehicle turning radii.
  * **Straight / Miter Corner Style:** Extends boundary lines until they meet at sharp miter points, capping miter length when acute angles would cause excessive geometric elongation.
* **Boundary Topology and Mesh Stitching:**
  * Fits n-gon patch surfaces or Delaunay / Constrained Delaunay Triangulation (CDT) meshes to bridge the gap between incoming road cross-sections.
  * Computes continuous UV coordinates across the junction patch using barycentric coordinates or harmonic map parameterization to align asphalt textures and road paint markings cleanly.

## 5. Engine and Toolchain Implementation Patterns

* **Unreal Engine (UE5 PCG & Spline Meshes):**
  * **Spline Components & Spline Mesh Components:** Deforms static road segment meshes along 3D cubic Hermite splines.
  * **PCG (Procedural Content Generation) Framework & PCGEx:** Uses spline samplers to sample transformation points along splines, applying lateral offsets for parallel roads. PCGEx (PCG Extended) provides advanced graph-clustering algorithms to detect spline intersections and spawn modular junction assets with socket alignment.
  * **Landscape Splines:** Automates terrain heightmap sculpting and layer blending directly beneath procedural road splines.
* **Unity Engine (Splines Package & EasyRoads3D):**
  * **Unity Splines API:** Provides underlying spline evaluation, knot manipulation, and mesh extrusion utilities. High-level road systems require custom C# mesh generation for multi-lane handling and junction resolution.
  * **EasyRoads3D:** Commercial ecosystem using dynamic crossing prefabs, flex connectors for non-perpendicular junctions, automatic terrain deformation, and custom connector mesh snapping.
* **Blender (Geometry Nodes):**
  * **Curve-to-Mesh & Ribbon Generation:** Converts 1D curves to 2D/3D road meshes using `Curve to Mesh` with custom profile curves or lateral translation nodes (`Set Position` along curve normals).
  * **Cusp & Self-Intersection Mitigation:** Uses `Resample Curve` to limit curvature, `Merge by Distance` for topology cleanup, and advanced `Raycast` push-out routines within `Repeat Zone` setups to iteratively push intersecting vertices out of overlap zones.
* **Esri CityEngine (CGA Shape Grammar):**
  * **Internal Node-Mesh Engine:** Automatically analyzes street graph topology, computing base 3D polygonal shapes for `Junction`, `Crossing`, and `Roundabout` nodes.
  * **CGA Grammar Skinning:** Applies hierarchical rule files (CGA) onto computed intersection polygons, performing operations like `split`, `offset`, and `extrude` to procedurally detail lane markings, curbs, sidewalks, and street props.
* **ASAM OpenDRIVE Standard:**
  * **Analytical Reference Representation:** Represents road networks via XML schema describing reference curves (`paramPoly3`, clothoids, spirals) and polynomial lateral lane offsets \(t(s)\).
  * **Intersections & Connections:** Defines logical junction connections (`junction` elements) specifying incoming/outgoing lane linkages. Simulation runtimes (CARLA, RoadRunner) dynamically generate procedural 3D visual and collision meshes from these analytical specifications.

## Sources

* https://docs.unrealengine.com
* https://docs.unity3d.com
* https://docs.blender.org
* https://www.asam.net/standards/detail/opendrive/
* https://pro.arcgis.com/en/pro-app/latest/help/editing/cityengine-streets-and-intersections.htm
* https://www.easyroads3d.com
* https://dev.epicgames.com/documentation/en-us/unreal-engine/procedural-content-generation-overview
* https://libgeos.org
* https://blend2d.com
* https://www.cad-journal.net
* https://mit.edu
* https://www.researchgate.net
