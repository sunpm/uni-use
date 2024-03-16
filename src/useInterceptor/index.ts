import { isPlainObject } from '@dcloudio/uni-app';
import { tryOnScopeDispose } from '../tryOnScopeDispose';

type FunctionKeys<T> = {
  [K in keyof T]: T[K] extends Function ? K : never;
}[keyof T];

type UniMethod = FunctionKeys<Uni>;

export interface InterceptorOptions<F extends UniMethod = UniMethod> {
  /** 返回 false 则终止执行 */
  invoke?: (args: Parameters<Uni[F]>) => void | boolean;

  success?: Parameters<Uni[F]>[0]['success'] | ReturnType<Uni[F]>;

  fail?: Parameters<Uni[F]>[0]['fail'] | ((err: any) => void);

  complete?: Parameters<Uni[F]>[0]['complete'] | (() => void);
}

const globalInterceptors: Record<string, Record<string, InterceptorOptions>> = {};
const originMethods = {} as Record<UniMethod, any>;
function wrappMethod(method: UniMethod) {
  if (method in originMethods) {
    return originMethods[method];
  }

  const origin = uni[method];

  originMethods[method] = origin;

  type FN = typeof origin;

  uni[method] = ((...args: Parameters<FN>) => {
    const interceptors = globalInterceptors[method] || {};

    const effectInterceptors: InterceptorOptions<UniMethod>[] = [];

    for (const [_key, interceptor] of Object.entries(interceptors)) {
      if (interceptor.invoke && interceptor.invoke(args) === false) {
        continue;
      }

      effectInterceptors.push(interceptor);
    }

    // 判断是否单一函数，且为object
    const isObjOption = args.length === 1 && isPlainObject(args[0]);

    if (isObjOption) {
      let resolve: (value: unknown) => void;
      let reject: (reason?: any) => void;
      const promise = new Promise((resolv, rej) => {
        resolve = resolv;
        reject = rej;
      });

      const opt = args[0];

      const oldSuccess = opt.success;
      opt.success = (result: any) => {
        for (const interceptor of effectInterceptors) {
          interceptor.success && interceptor.success(result);
        }
        oldSuccess && oldSuccess(result);
        resolve(result);
      };

      const oldFail = opt.fail;
      opt.fail = (err: any) => {
        for (const interceptor of effectInterceptors) {
          interceptor.fail && interceptor.fail(err);
        }
        oldFail && oldFail(err);
        reject(err);
      };

      const oldComplete = opt.complete;
      opt.complete = () => {
        for (const interceptor of effectInterceptors) {
          interceptor.complete && interceptor.complete();
        }
        oldComplete && oldComplete();
      };

      const returnVal = (origin as any)(opt);

      return (returnVal === undefined) ? promise : returnVal;
    }
    else {
      try {
        const result = (origin as any)(...args);

        for (const interceptor of effectInterceptors) {
          interceptor.success && interceptor.success(result);
        }

        return result;
      }
      catch (err: any) {
        for (const interceptor of effectInterceptors) {
          interceptor.fail && interceptor.fail(err);
        }
      }
      finally {
        for (const interceptor of effectInterceptors) {
          interceptor.complete && interceptor.complete();
        }
      }
    }
  }) as any;

  return origin;
}

/**
 * 注册拦截器，在活跃的 effect 作用域停止时自动移除
 *
 * https://cn.vuejs.org/api/reactivity-advanced.htmlSeffectscope
 */
export function useInterceptor<F extends UniMethod>(method: F, interceptor: InterceptorOptions<F>) {
  wrappMethod(method);

  globalInterceptors[method] = globalInterceptors[method] || {};
  const key = Math.random().toString(36).slice(-8);
  globalInterceptors[method][key] = interceptor;

  const stop = () => {
    delete globalInterceptors[method][key];
  };

  tryOnScopeDispose(stop);

  return stop;
}
