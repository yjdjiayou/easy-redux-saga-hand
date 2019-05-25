import {take,put,takeEvery,call,cps,all,delay,fork,cancel} from '../../redux-saga/effects';
import * as types from '../action-types';
function* increment(){
    while(true){
        yield delay(1000);
        yield put({type:types.INCREMENT});
    }
}

export default function*(){
    const task = yield fork(increment);//task = increment()
    //take 实际的作用就是监听动作，暂停 generator 的执行
    //只有当监听的动作发生时，才会 恢复 generator 的执行
    yield take(types.STOP_INCREMENT);
    yield cancel(task);
}