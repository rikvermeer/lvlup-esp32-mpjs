export class IDs {
    private static _nextId: number = 0
    static get nextId() {
        console.log((new Error()).stack)
        return this._nextId++
    }

}