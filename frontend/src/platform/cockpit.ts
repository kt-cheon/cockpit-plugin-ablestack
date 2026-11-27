// Preserve the existing authenticated administrator bridge, including remote Cube Agent calls.
const native = (window as any).cockpit;
const operations = (window as any).ablestack;
const cockpit = native ? Object.assign(Object.create(native), {
  spawn: (...args: any[]) => operations.spawn(...args),
  script: (...args: any[]) => operations.script(...args),
  file: (...args: any[]) => operations.file(...args),
}) : undefined;
export default cockpit;
