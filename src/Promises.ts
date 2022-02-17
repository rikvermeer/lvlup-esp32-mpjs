/**
 * Reject promise on timeout, useful with Promise.race([...])
 * @param timoutMs
 */
export const timeoutReject = async (timoutMs: number): Promise<any> => {
    return new Promise((resolve, reject) => {setTimeout(reject, timoutMs, 'timeout')})
}

/**
 * Make 1 or more promises race against a timeout
 * @param timoutMs
 * @param promises
 */
export const doOrTimeout = async <T>(timoutMs: number, ...promises: Promise<T>[]): Promise<T> => {
    return Promise.race([...promises, timeoutReject(timoutMs)])
}