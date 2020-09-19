import {
    ObservableValue,
    IInterceptable,
    IListenable,
    ComputedValue,
    IObservableArray,
    IEnhancer,
    hasInterceptors,
    interceptChange,
    globalState,
    hasListeners,
    isSpyEnabled,
    spyReportStart,
    notifyListeners,
    spyReportEnd,
    startBatch,
    endBatch,
    Lambda,
    invariant,
    registerListener,
    registerInterceptor,
    ObservableArray,
    referenceEnhancer,
    deepEnhancer,
    isPlainObject,
    getNextId,
    addHiddenFinalProp,
    assertPropertyConfigurable,
    IComputedValueOptions,
    initializeInstance,
    createInstanceofPredicate,
    isObject
} from "../internal"

export interface IObservableObject {
    "observable-object": IObservableObject
}

export type IObjectDidChange<T = any> =
    | {
          name: string
          object: T
          type: "add"
          newValue: any
      }
    | {
          name: string
          object: T
          type: "update"
          oldValue: any
          newValue: any
      }
    | {
          name: string
          object: T
          type: "remove"
          oldValue: any
      }

export type IObjectWillChange<T = any> =
    | {
          object: T
          type: "update" | "add"
          name: string
          newValue: any
      }
    | {
          object: T
          type: "remove"
          name: string
      }

export class ObservableObjectAdministration
    implements IInterceptable<IObjectWillChange>, IListenable {
    values: { [key: string]: ObservableValue<any> | ComputedValue<any> } = {}
    keys: undefined | IObservableArray<string>
    changeListeners
    interceptors

    constructor(public target: any, public name: string, public defaultEnhancer: IEnhancer<any>) {}

    read(owner: any, key: string) {
        if (process.env.NODE_ENV === "production" && this.target !== owner) {
            this.illegalAccess(owner, key)
            if (!this.values[key]) return undefined
        }
        return this.values[key].get()
    }

    write(owner: any, key: string, newValue) {
        const instance = this.target
        if (process.env.NODE_ENV === "production" && instance !== owner) {
            this.illegalAccess(owner, key)
        }
        const observable = this.values[key]
        if (observable instanceof ComputedValue) {
            observable.set(newValue)
            return
        }

        // intercept
        if (hasInterceptors(this)) {
            const change = interceptChange<IObjectWillChange>(this, {
                type: "update",
                object: instance,
                name: key,
                newValue
            })
            if (!change) return
            newValue = (change as any).newValue
        }
        newValue = (observable as any).prepareNewValue(newValue)

        // notify spy & observers
        if (newValue !== globalState.UNCHANGED) {
            const notify = hasListeners(this)
            const notifySpy = isSpyEnabled()
            const change =
                notify || notifySpy
                    ? {
                          type: "update",
                          object: instance,
                          oldValue: (observable as any).value,
                          name: key,
                          newValue
                      }
                    : null

            if (notifySpy) spyReportStart({ ...change, name: this.name, key })
            ;(observable as ObservableValue<any>).setNewValue(newValue)
            if (notify) notifyListeners(this, change)
            if (notifySpy) spyReportEnd()
        }
    }

    remove(key: string) {
        if (!this.values[key]) return
        const { target } = this
        if (hasInterceptors(this)) {
            const change = interceptChange<IObjectWillChange>(this, {
                object: target,
                name: key,
                type: "remove"
            })
            if (!change) return
        }
        try {
            startBatch()
            const notify = hasListeners(this)
            const notifySpy = isSpyEnabled()
            const oldValue = this.values[key].get()
            if (this.keys) this.keys.remove(key)
            delete this.values[key]
            delete this.target[key]
            const change =
                notify || notifySpy
                    ? {
                          type: "remove",
                          object: target,
                          oldValue: oldValue,
                          name: key
                      }
                    : null
            if (notifySpy) spyReportStart({ ...change, name: this.name, key })
            if (notify) notifyListeners(this, change)
            if (notifySpy) spyReportEnd()
        } finally {
            endBatch()
        }
    }

    illegalAccess(owner, propName) {
        /**
         * This happens if a property is accessed through the prototype chain, but the property was
         * declared directly as own property on the prototype.
         *
         * E.g.:
         * class A {
         * }
         * extendObservable(A.prototype, { x: 1 })
         *
         * classB extens A {
         * }
         * console.log(new B().x)
         *
         * It is unclear whether the property should be considered 'static' or inherited.
         * Either use `console.log(A.x)`
         * or: decorate(A, { x: observable })
         *
         * When using decorate, the property will always be redeclared as own property on the actual instance
         */
        console.warn(
            `Property '${propName}' of '${owner}' was accessed through the prototype chain. Use 'decorate' instead to declare the prop or access it statically through it's owner`
        )
    }

    /**
     * Observes this object. Triggers for the events 'add', 'update' and 'delete'.
     * See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/observe
     * for callback details
     */
    observe(callback: (changes: IObjectDidChange) => void, fireImmediately?: boolean): Lambda {
        process.env.NODE_ENV !== "production" &&
            invariant(
                fireImmediately !== true,
                "`observe` doesn't support the fire immediately property for observable objects."
            )
        return registerListener(this, callback)
    }

    intercept(handler): Lambda {
        return registerInterceptor(this, handler)
    }

    getKeys(): string[] {
        if (this.keys === undefined) {
            this.keys = <any>(
                new ObservableArray(
                    Object.keys(this.values).filter(
                        key => this.values[key] instanceof ObservableValue
                    ),
                    referenceEnhancer,
                    `keys(${this.name})`,
                    true
                )
            )
        }
        return this.keys!.slice()
    }
}

export interface IIsObservableObject {
    $mobx: ObservableObjectAdministration
}

export function asObservableObject(
    target,
    name: string = "",
    defaultEnhancer: IEnhancer<any> = deepEnhancer
): ObservableObjectAdministration {
    let adm = (target as any).$mobx
    if (adm) return adm

    process.env.NODE_ENV !== "production" &&
        invariant(
            Object.isExtensible(target),
            "Cannot make the designated object observable; it is not extensible"
        )
    if (!isPlainObject(target))
        name = (target.constructor.name || "ObservableObject") + "@" + getNextId()
    if (!name) name = "ObservableObject@" + getNextId()

    adm = new ObservableObjectAdministration(target, name, defaultEnhancer)
    addHiddenFinalProp(target, "$mobx", adm)
    return adm
}

export function defineObservableProperty(
    target: any,
    propName: string,
    newValue,
    enhancer: IEnhancer<any>
) {
    const adm = asObservableObject(target)
    assertPropertyConfigurable(target, propName)

    if (hasInterceptors(adm)) {
        const change = interceptChange<IObjectWillChange>(adm, {
            object: target,
            name: propName,
            type: "add",
            newValue
        })
        if (!change) return
        newValue = (change as any).newValue
    }
    const observable = (adm.values[propName] = new ObservableValue(
        newValue,
        enhancer,
        `${adm.name}.${propName}`,
        false
    ))
    newValue = (observable as any).value // observableValue might have changed it

    Object.defineProperty(target, propName, generateObservablePropConfig(propName))
    if (adm.keys) adm.keys.push(propName)
    notifyPropertyAddition(adm, target, propName, newValue)
}

export function defineComputedProperty(
    target: any, // which objects holds the observable and provides `this` context?
    propName: string,
    options: IComputedValueOptions<any>
) {
    const adm = asObservableObject(target)
    options.name = `${adm.name}.${propName}`
    options.context = target
    adm.values[propName] = new ComputedValue(options)
    Object.defineProperty(target, propName, generateComputedPropConfig(propName))
}

const observablePropertyConfigs = Object.create(null)
const computedPropertyConfigs = Object.create(null)

export function generateObservablePropConfig(propName) {
    return (
        observablePropertyConfigs[propName] ||
        (observablePropertyConfigs[propName] = {
            configurable: true,
            enumerable: true,
            get() {
                return this.$mobx.read(this, propName)
            },
            set(v) {
                this.$mobx.write(this, propName, v)
            }
        })
    )
}

function getAdministrationForComputedPropOwner(owner: any): ObservableObjectAdministration {
    const adm = owner.$mobx
    if (!adm) {
        // because computed props are declared on proty,
        // the current instance might not have been initialized yet
        initializeInstance(owner)
        return owner.$mobx
    }
    return adm
}

export function generateComputedPropConfig(propName) {
    return (
        computedPropertyConfigs[propName] ||
        (computedPropertyConfigs[propName] = {
            configurable: globalState.computedConfigurable,
            enumerable: false,
            get() {
                return getAdministrationForComputedPropOwner(this).read(this, propName)
            },
            set(v) {
                getAdministrationForComputedPropOwner(this).write(this, propName, v)
            }
        })
    )
}

function notifyPropertyAddition(
    adm: ObservableObjectAdministration,
    object,
    key: string,
    newValue
) {
    const notify = hasListeners(adm)
    const notifySpy = isSpyEnabled()
    const change =
        notify || notifySpy
            ? {
                  type: "add",
                  object,
                  name: key,
                  newValue
              }
            : null

    if (notifySpy) spyReportStart({ ...change, name: adm.name, key })
    if (notify) notifyListeners(adm, change)
    if (notifySpy) spyReportEnd()
}

const isObservableObjectAdministration = createInstanceofPredicate(
    "ObservableObjectAdministration",
    ObservableObjectAdministration
)

export function isObservableObject(thing: any): thing is IObservableObject {
    if (isObject(thing)) {
        // Initializers run lazily when transpiling to babel, so make sure they are run...
        initializeInstance(thing)
        return isObservableObjectAdministration((thing as any).$mobx)
    }
    return false
}
