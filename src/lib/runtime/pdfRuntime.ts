const parseNodeVersion = (version: string): { major: number; minor: number } | null => {
  const [majorPart, minorPart] = version.split(".");
  const major = Number.parseInt(majorPart ?? "", 10);
  const minor = Number.parseInt(minorPart ?? "", 10);

  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return null;
  }

  return { major, minor };
};

export const isPdfRuntimeCompatible = (version = process.versions.node): boolean => {
  const parsed = parseNodeVersion(version);
  if (!parsed) {
    return false;
  }

  const { major, minor } = parsed;

  if (major < 20) {
    return false;
  }

  if (major === 20) {
    return minor >= 16;
  }

  if (major === 21) {
    return false;
  }

  if (major === 22) {
    return minor >= 3;
  }

  return major > 22;
};

export const getPdfRuntimeRequirementMessage = (version = process.versions.node): string =>
  `This deployment is running Node ${version}. pdfjs-dist@5 requires Node >=20.16.0 or >=22.3.0. On Vercel, set Project Settings -> Node.js Version to 22.x (or >=20.16), then redeploy.`;

export const assertPdfRuntimeCompatible = (): void => {
  if (!isPdfRuntimeCompatible()) {
    throw new Error(getPdfRuntimeRequirementMessage());
  }
};
