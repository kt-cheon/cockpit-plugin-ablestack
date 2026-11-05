export type ValidationMessage = string;

const IPV4_SEGMENT = "(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])";
const IPV4_REGEX = new RegExp(`^${IPV4_SEGMENT}\\.${IPV4_SEGMENT}\\.${IPV4_SEGMENT}\\.${IPV4_SEGMENT}$`);
const CIDR_REGEX = new RegExp(`^${IPV4_SEGMENT}\\.${IPV4_SEGMENT}\\.${IPV4_SEGMENT}\\.${IPV4_SEGMENT}\\/(3[0-2]|[12]?[0-9])$`);
const HOSTNAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/;
const DOMAIN_REGEX = /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalize = (value: unknown) => String(value ?? "").trim();

export const isBlank = (value: unknown) => normalize(value) === "";

export const isIpv4 = (value: unknown) => IPV4_REGEX.test(normalize(value));

export const isIpv4Cidr = (value: unknown) => CIDR_REGEX.test(normalize(value));

export const getIpFromCidr = (value: unknown) => normalize(value).split("/")[0];

export const isHostname = (value: unknown) => HOSTNAME_REGEX.test(normalize(value));

export const isHostAddress = (value: unknown) => {
  const target = normalize(value);
  return isIpv4(target) || DOMAIN_REGEX.test(target);
};

export const isEmail = (value: unknown) => EMAIL_REGEX.test(normalize(value));

export const isInteger = (value: unknown) => /^-?\d+$/.test(normalize(value));

export const isIntegerInRange = (value: unknown, min: number, max: number) => {
  if (!isInteger(value)) return false;
  const numberValue = Number(normalize(value));
  return numberValue >= min && numberValue <= max;
};

export const isPort = (value: unknown) => isIntegerInRange(value, 1, 65535);

export const isVlanId = (value: unknown) => isBlank(value) || isIntegerInRange(value, 1, 4094);

export const firstError = (...messages: Array<ValidationMessage | false | null | undefined>) =>
  messages.find((message): message is ValidationMessage => typeof message === "string" && message.length > 0) ?? "";

export const requireValue = (value: unknown, message: ValidationMessage) =>
  isBlank(value) ? message : "";

export const requireIpv4 = (value: unknown, label: string) =>
  firstError(requireValue(value, `${label}를 입력해주세요.`), isIpv4(value) ? "" : `${label} 형식을 확인해주세요.`);

export const requireIpv4Cidr = (value: unknown, label: string) =>
  firstError(requireValue(value, `${label}를 입력해주세요.`), isIpv4Cidr(value) ? "" : `${label} 형식을 확인해주세요.`);

export const optionalIpv4 = (value: unknown, label: string) =>
  !isBlank(value) && !isIpv4(value) ? `${label} 형식을 확인해주세요.` : "";

export const optionalHostAddress = (value: unknown, label: string) =>
  !isBlank(value) && !isHostAddress(value) ? `${label} 형식을 확인해주세요.` : "";

export const requireHostname = (value: unknown, label = "호스트명") =>
  firstError(requireValue(value, `${label}을 입력해주세요.`), isHostname(value) ? "" : `${label} 입력 형식을 확인해주세요.`);

export const requirePort = (value: unknown, label: string) =>
  firstError(requireValue(value, `${label}를 입력해주세요.`), isPort(value) ? "" : `${label} 형식을 확인해주세요.`);

export const requireEmail = (value: unknown, label: string) =>
  firstError(requireValue(value, `${label}를 입력해주세요.`), isEmail(value) ? "" : `${label} 형식을 확인해주세요.`);

export const optionalVlan = (value: unknown, label: string) =>
  !isVlanId(value) ? `${label}는 1~4094 범위의 숫자로 입력해주세요.` : "";

export const duplicateMessage = (values: unknown[], message: ValidationMessage) => {
  const seen = new Set<string>();
  for (const value of values.map(normalize).filter(Boolean)) {
    if (seen.has(value)) return message;
    seen.add(value);
  }
  return "";
};

export const requireFileName = (
  filename: string,
  expected: string,
  message = `'${expected}' 파일만 업로드할 수 있습니다.`
) => {
  if (isBlank(filename)) return `${expected} 파일을 선택해주세요.`;
  return normalize(filename) === expected ? "" : message;
};

export const requireClusterJsonFileName = (filename: string) => {
  if (isBlank(filename)) return "cluster.json 파일을 선택해주세요.";
  return normalize(filename).toLowerCase() === "cluster.json"
    ? ""
    : "'cluster.json' 파일만 업로드할 수 있습니다.";
};
