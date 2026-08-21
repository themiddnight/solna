/**
 * Decorator for automatic performance monitoring of methods
 */

import { boundedContextMonitor } from './BoundedContextMonitor';

export interface MonitoringOptions {
  context: string;
  metricName?: string;
  tags?: Record<string, string>;
}

type AnyFunction = (...args: unknown[]) => unknown;

/**
 * Method decorator that automatically measures execution time
 */
export function Monitor(options: MonitoringOptions) {
  return function (_target: unknown, propertyName: string, descriptor?: PropertyDescriptor): PropertyDescriptor | void {
    if (!descriptor) {
      // Handle property decorator case
      return;
    }

    const method = descriptor.value as AnyFunction | undefined;
    const metricName = options.metricName || propertyName;

    if (method == null) return descriptor;

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      return await boundedContextMonitor.monitorOperation(
        options.context,
        metricName,
        async () => {
          return await method.apply(this, args);
        }
      );
    };

    return descriptor;
  };
}

/**
 * Class decorator that automatically monitors all public methods
 */
export function MonitorClass(context: string, _tags?: Record<string, string>) {
  return function <T extends { new (...args: unknown[]): object }>(constructor: T) {
    const prototype = constructor.prototype as Record<string, unknown>;
    const methodNames = Object.getOwnPropertyNames(prototype)
      .filter(name => name !== 'constructor' && typeof prototype[name] === 'function');

    methodNames.forEach(methodName => {
      const originalMethod = prototype[methodName] as AnyFunction;
      
      prototype[methodName] = async function (this: unknown, ...args: unknown[]) {
        return await boundedContextMonitor.monitorOperation(
          context,
          `${constructor.name}.${methodName}`,
          async () => {
            return await originalMethod.apply(this, args);
          }
        );
      };
    });

    return constructor;
  };
}
