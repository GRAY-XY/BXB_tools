function busyError() {
  const error = new Error("学期正在切换或有课程相关操作尚未结束，请等待完成后重试。");
  error.code = "academic_context_busy";
  return error;
}

// Readers can overlap, but a context change cannot overlap any account operation.
export class AcademicContextCoordinator {
  #operations = 0;
  #switching = false;

  async runOperation(operation) {
    if (this.#switching) throw busyError();
    this.#operations += 1;
    try {
      return await operation();
    } finally {
      this.#operations -= 1;
    }
  }

  async runSwitch(operation) {
    if (this.#switching || this.#operations > 0) throw busyError();
    this.#switching = true;
    try {
      return await operation();
    } finally {
      this.#switching = false;
    }
  }
}
