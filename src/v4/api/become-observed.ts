import {
    IObservableArray,
    IObservable,
    IComputedValue,
    ObservableMap,
    ObservableSet,
    Lambda,
    getAtom,
    fail
} from "../internal"

export function onBecomeObserved(
    value:
        | IObservable
        | IComputedValue<any>
        | IObservableArray<any>
        | ObservableMap<any, any>
        | ObservableSet<any>,
    listener: Lambda
): Lambda
export function onBecomeObserved<K, V = any>(
    value: ObservableMap<K, V> | Object,
    property: K,
    listener: Lambda
): Lambda
export function onBecomeObserved(thing, arg2, arg3?): Lambda {
    return interceptHook("onBecomeObserved", thing, arg2, arg3)
}

export function onBecomeUnobserved(
    value:
        | IObservable
        | IComputedValue<any>
        | IObservableArray<any>
        | ObservableMap<any, any>
        | ObservableSet<any>,
    listener: Lambda
): Lambda
export function onBecomeUnobserved<K, V = any>(
    value: ObservableMap<K, V> | Object,
    property: K,
    listener: Lambda
): Lambda
export function onBecomeUnobserved(thing, arg2, arg3?): Lambda {
    return interceptHook("onBecomeUnobserved", thing, arg2, arg3)
}

function interceptHook(hook: "onBecomeObserved" | "onBecomeUnobserved", thing, arg2, arg3) {
    const atom: IObservable =
        typeof arg3 === "function" ? getAtom(thing, arg2) : (getAtom(thing) as any)
    const cb = typeof arg3 === "function" ? arg3 : arg2
    const orig = atom[hook]

    if (typeof orig !== "function")
        return fail(process.env.NODE_ENV !== "production" && "Not an atom that can be (un)observed")

    atom[hook] = function() {
        orig.call(this)
        cb.call(this)
    }
    return function() {
        atom[hook] = orig
    }
}
