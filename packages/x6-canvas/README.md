# `@grafting/x6-canvas`

Generic AntV X6 wrapper shared by graph-oriented products (DEC-046). Its first
real consumer is the Graph IR viewer spike. The public API does not expose the
mutable X6 `Graph`; it returns only counts, center, and dispose operations.

The package contains no Graph IR or VTT domain logic.
