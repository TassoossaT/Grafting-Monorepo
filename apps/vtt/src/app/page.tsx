export default function ProductHomePage() {
  return (
    <main className="product-shell">
      <p className="eyebrow">Grafting VTT • Studio do Mestre</p>
      <h1>Crie e Deforme Mapas RPG em Tempo Real.</h1>
      <p className="lede">
        Workspace interativo de construção procedural 3D powered by Rust & WASM.
        Gere masmorras em blocos brancos e cinzas, ajuste vértices e posicione tokens.
      </p>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <a className="primary-link" href="/table/demo">
          Abrir Mesa de Construção Demo (/table/demo)
        </a>
        <a className="primary-link" style={{ borderColor: "#475569", color: "#cbd5e1", background: "#1e293b" }} href="/table/masmorra-1">
          Abrir Mesa Masmorra (/table/masmorra-1)
        </a>
      </div>
    </main>
  );
}

