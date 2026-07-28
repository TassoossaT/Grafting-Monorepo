namespace Grafting.Isekai.Interop;

/// <summary>
/// Managed projection of <c>grafting-isekai-capi</c>'s <c>EngineAbiInfo</c>.
/// Master source S12.3: "the C# wrapper validates this at startup" --
/// <see cref="Engine.GetAbiInfo"/> is that check's entry point.
/// </summary>
public readonly record struct AbiInfo(uint AbiMajor, uint AbiMinor, uint FeatureFlags, uint ProtocolVersion)
{
    public const uint SupportedAbiMajor = 1;

    public bool IsCompatible => AbiMajor == SupportedAbiMajor;
}
