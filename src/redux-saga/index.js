function createChannel(){
    let observer = {};
    function subscribe(actionType,callback){
        observer[actionType]=callback;
    }
    function publish(action){
        if(observer[action.type]){
            let next = observer[action.type];//next
            delete observer[action.type];
            //当监听的动作发生时，恢复 generator 的执行
            next(action);
            //为什么下面的代码不行？
            //需要先删除后调用next，否则当下一次注册事件后，事件会被后面的删除语句删除（第一次注册事件没有关系）
            //observer[action.type](action);
            //delete observer[action.type];
        }
    }
    return {subscribe,publish};
}

export default function createSagaMiddleware(){

    let channel = createChannel();
    function sagaMiddleware({dispatch,getState}){
        //把 run 函数定义在这里，是为了能获取到 {getState,dispatch}
        //run 只会被初始化一次
        function run(generator,callback){
            let it = typeof generator[Symbol.iterator] == 'function'?generator:generator();
            function next(action){
                //每次调用it.next()时，会遇到下一个 yield 表达式就停止
                //并将紧跟在 yield 后面的那个表达式的值(注意：yield 后面的表达式会计算的)，作为返回的对象的value属性值
                //next方法的参数表示上一个yield表达式的返回值
                // 所以在第一次使用next方法时，传递参数是无效的。
                // V8 引擎直接忽略第一次使用next方法时的参数，
                // 只有从第二次使用next方法开始，参数才是有效的。
                // 从语义上讲，第一个next方法用来启动遍历器对象，所以不用带有参数。
                // value={type:'TAKE',actionType:ASYNC_INCREMENT}
                let {value:effect,done} = it.next(action);//{value,done}
                if(!done){
                    if(typeof effect[Symbol.iterator]  == 'function'){
                        //如果是一个迭代器的话直接传入run方法进行执行
                        //这里不会阻塞后面的 next()运行
                        //一般 run 方法在 store 中调用一次就够了
                        //之后大量的操作都是围绕着这个 run 方法来实现的
                        //这里重新调用了 run 方法，所以 effect 这个迭代器里面的操作都是围绕这里 的 run来的
                        //相当于新开了一个子进程
                        run(effect);
                        next();
                    }else if(typeof effect.then == 'function' ){
                        effect.then(next);
                    }else{
                        switch(effect.type){
                            case 'TAKE':
                                //observer[ASYNC_INCREMENT]=next
                                channel.subscribe(effect.actionType,next);
                             //注意：这里并没有调用 next 方法，所以 generator 会被暂停
                             //只有当加监听的动作发生的时候，generator 才会往下执行
                             break;
                            case 'PUT': //{type:'PUT',action:{type:INCREMENT}}
                                //注意：saga 的使用场景：异步的时候使用
                                //而在自定义的 saga 里面想要派发 action 就靠 put
                                //这里的 dispatch 是重新封装过的dispatch，非原始的 store.dispatch 方法
                                dispatch(effect.action);
                                //调用 next 方法
                                //generator 往下执行
                                next();
                                break;
                            case 'FORK':
                                let newTask =  effect.task();
                                //这里不会阻塞后面的 next()运行
                                //一般 run 方法在 store 中调用一次就够了
                                //之后大量的操作都是围绕着这个 run 方法来实现的
                                //这里重新调用了 run 方法，所以 newTask 这个迭代器里面的操作都是围绕这里的 run 来的
                                //相当于新开了一个子进程
                                run(newTask);
                                next(newTask);//为了 fork 不阻塞后面的代码执行，这里要调用 next
                                break;
                            case 'CANCEL':
                                //effect.task 是一个迭代器
                                //return()是将当前的 yield 表达式替换成一个 return 语句
                                //这样 generator 就不会再执行了
                                effect.task.return('任务直接结束');
                                break;    
                            case 'CALL':
                                //这里需要判断 fn 是一个 generator 还是一个会返回 promise 的函数
                                if(effect.fn.then === 'function'){
                                    //把 next 作为成功的回调
                                    effect.fn(...effect.args).then(next);
                                }else if(effect.fn.constructor.name === 'GeneratorFunction'){
                                    run(effect.fn);
                                }
                                break;
                            case 'CPS':
                                //将 next 作为回调函数传入一个需要调用回调函数的函数中
                                effect.fn(...effect.args,next);
                                break;
                            case 'ALL':
                                function times(cb,length){
                                        let count = 0;
                                        return function(){
                                            if(++count === length){
                                              cb();
                                            }
                                        }                                  
                                }
                                let fns = effect.fns;//2
                                let done = times(next,fns.length);
                                //相当于 promise 中的 all
                                //不会阻塞，相当于新开一个子进程运行
                                effect.fns.forEach(fn=>run(fn,done));    
                                break;     
                            default:
                                break;
                       } 
                    }
                }else{
                    callback&&callback();
                }
            }
            //调用 next 就是调用 it.next()
            next();
        }
        sagaMiddleware.run =run;
        return function(next){
            //每次重新派发 action 的时候，都走下面这个函数，上面的不会走的
            return function(action){
                //每次派发 action 的时候，判断当前监听事件列表中是否匹配 action.type
                //有的话就去执行对应的事件
                //下面这句话有点废话，但是之前钻牛角尖了，写在这里提醒下自己
                //注意：并不是只有 put 才会派发动作
                //用户的点击行为也能派发动作
                channel.publish(action);
                next(action);
            }
        }
    }
    return sagaMiddleware;
}

