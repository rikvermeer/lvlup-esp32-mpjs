const target = new EventTarget()
const eventBus = {
    on(event: string, callback: Function) {
        target.addEventListener(event, (e: CustomEventInit) => callback(e.detail));
    },
    dispatch(event: string, data: any) {
        target.dispatchEvent(new CustomEvent(event, { detail: data }));
    },
    remove(event: string, callback: any) {
        target.removeEventListener(event, callback);
    },
};

export default eventBus;