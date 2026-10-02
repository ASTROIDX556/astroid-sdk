import { describe, expect, it, vi } from 'vitest';
import {
  NotificationDispatcher,
  patternToRegExp,
  type NotificationHandler,
} from './dispatcher';

describe('patternToRegExp', () => {
  it('handles exact literal patterns', () => {
    const regex = patternToRegExp('agent.created');
    expect(regex.test('agent.created')).toBe(true);
    expect(regex.test('agent.deleted')).toBe(false);
    expect(regex.test('agent.created.sub')).toBe(false);
    expect(regex.test('sub.agent.created')).toBe(false);
  });

  it('handles single-segment wildcards (*)', () => {
    const regex = patternToRegExp('agent.*');
    expect(regex.test('agent.created')).toBe(true);
    expect(regex.test('agent.deleted')).toBe(true);
    expect(regex.test('agent')).toBe(false);
    expect(regex.test('agent.task.created')).toBe(false);

    const midRegex = patternToRegExp('agent.*.completed');
    expect(midRegex.test('agent.task.completed')).toBe(true);
    expect(midRegex.test('agent.workflow.completed')).toBe(true);
    expect(midRegex.test('agent.completed')).toBe(false);
    expect(midRegex.test('agent.task.step.completed')).toBe(false);
  });

  it('handles multi-segment wildcards (** and #)', () => {
    const doubleStar = patternToRegExp('policy.**');
    expect(doubleStar.test('policy')).toBe(true);
    expect(doubleStar.test('policy.violation')).toBe(true);
    expect(doubleStar.test('policy.violation.critical')).toBe(true);
    expect(doubleStar.test('audit.violation')).toBe(false);

    const hashRegex = patternToRegExp('audit.#');
    expect(hashRegex.test('audit')).toBe(true);
    expect(hashRegex.test('audit.log')).toBe(true);
    expect(hashRegex.test('audit.log.export.requested')).toBe(true);
    expect(hashRegex.test('system.log')).toBe(false);
  });

  it('handles universal wildcards (*, **, # alone)', () => {
    for (const pattern of ['*', '**', '#']) {
      const regex = patternToRegExp(pattern);
      expect(regex.test('agent.created')).toBe(true);
      expect(regex.test('single')).toBe(true);
      expect(regex.test('a.b.c.d.e')).toBe(true);
    }
  });

  it('escapes special regex characters in literal tokens', () => {
    const regex = patternToRegExp('price+$100.*');
    expect(regex.test('price+$100.usd')).toBe(true);
    expect(regex.test('priceX$100.usd')).toBe(false);
  });
});

describe('NotificationDispatcher', () => {
  it('subscribes and receives matching events with topic and payload', async () => {
    const dispatcher = new NotificationDispatcher();
    const handler = vi.fn();

    dispatcher.subscribe('agent.created', handler);
    await dispatcher.dispatch('agent.created', { id: 'ag_1', name: 'Alpha' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ id: 'ag_1', name: 'Alpha' }, 'agent.created');
  });

  it('does not invoke handlers when topic does not match pattern', async () => {
    const dispatcher = new NotificationDispatcher();
    const handler = vi.fn();

    dispatcher.subscribe('agent.created', handler);
    await dispatcher.dispatch('agent.deleted', { id: 'ag_1' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('dispatches to multiple matching patterns (exact and wildcards)', async () => {
    const dispatcher = new NotificationDispatcher();
    const exactHandler = vi.fn();
    const wildcardHandler = vi.fn();
    const catchAllHandler = vi.fn();

    dispatcher.subscribe('policy.violation', exactHandler);
    dispatcher.subscribe('policy.*', wildcardHandler);
    dispatcher.subscribe('policy.**', catchAllHandler);

    await dispatcher.dispatch('policy.violation', { severity: 'high' });

    expect(exactHandler).toHaveBeenCalledTimes(1);
    expect(wildcardHandler).toHaveBeenCalledTimes(1);
    expect(catchAllHandler).toHaveBeenCalledTimes(1);
  });

  it('supports unsubscription via returned handle and avoids memory leaks', async () => {
    const dispatcher = new NotificationDispatcher();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const sub1 = dispatcher.subscribe('agent.*', handler1);
    const sub2 = dispatcher.subscribe('agent.*', handler2);

    expect(dispatcher.listenerCount('agent.*')).toBe(2);
    expect(dispatcher.patterns()).toEqual(['agent.*']);

    // Unsubscribe first
    sub1.unsubscribe();
    expect(dispatcher.listenerCount('agent.*')).toBe(1);

    await dispatcher.dispatch('agent.created', { id: '1' });
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);

    // Unsubscribe second (last one) — record should be deleted from map
    sub2.unsubscribe();
    expect(dispatcher.listenerCount('agent.*')).toBe(0);
    expect(dispatcher.hasSubscribers('agent.*')).toBe(false);
    expect(dispatcher.patterns()).toEqual([]);

    // Double unsubscription is a safe no-op
    expect(() => sub1.unsubscribe()).not.toThrow();
  });

  it('supports manual unsubscription via unsubscribe method', () => {
    const dispatcher = new NotificationDispatcher();
    const handler: NotificationHandler = vi.fn();

    dispatcher.subscribe('test.topic', handler);
    expect(dispatcher.hasSubscribers('test.topic')).toBe(true);

    const removed = dispatcher.unsubscribe('test.topic', handler);
    expect(removed).toBe(true);
    expect(dispatcher.hasSubscribers('test.topic')).toBe(false);

    // Removing non-existent handler returns false
    expect(dispatcher.unsubscribe('test.topic', handler)).toBe(false);
    expect(dispatcher.unsubscribe('non.existent', handler)).toBe(false);
  });

  it('supports dispatchSync for synchronous delivery', () => {
    const dispatcher = new NotificationDispatcher();
    const received: string[] = [];

    dispatcher.subscribe('sync.event', (data: string) => {
      received.push(data);
    });

    dispatcher.dispatchSync('sync.event', 'item-1');
    dispatcher.dispatchSync('sync.event', 'item-2');

    expect(received).toEqual(['item-1', 'item-2']);
  });

  it('clears all listeners with clear()', () => {
    const dispatcher = new NotificationDispatcher();
    dispatcher.subscribe('a.*', vi.fn());
    dispatcher.subscribe('b.*', vi.fn());
    dispatcher.subscribe('c.*', vi.fn());

    expect(dispatcher.listenerCount()).toBe(3);
    expect(dispatcher.patterns().length).toBe(3);

    dispatcher.clear();

    expect(dispatcher.listenerCount()).toBe(0);
    expect(dispatcher.patterns()).toEqual([]);
  });

  it('validates input arguments strictly', async () => {
    const dispatcher = new NotificationDispatcher();
    
    expect(() => dispatcher.subscribe('', () => {})).toThrow(TypeError);
    expect(() => dispatcher.subscribe('   ', () => {})).toThrow(TypeError);
    // Passing null as handler should throw TypeError
    expect(() => dispatcher.subscribe('topic', null as any)).toThrow(TypeError);

    expect(() => dispatcher.dispatchSync('', 'payload')).toThrow(TypeError);
    await expect(dispatcher.dispatch('', 'payload')).rejects.toThrow(TypeError);
  });

  it('invokes onError hook and aggregates handler errors on dispatch', async () => {
    const onError = vi.fn();
    const dispatcher = new NotificationDispatcher({ onError });

    const err1 = new Error('Handler 1 fail');
    const err2 = new Error('Handler 2 fail');

    dispatcher.subscribe('fail.topic', async () => {
      throw err1;
    });
    dispatcher.subscribe('fail.topic', async () => {
      throw err2;
    });

    await expect(dispatcher.dispatch('fail.topic', {})).rejects.toThrow(AggregateError);

    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(err1, 'fail.topic', 'fail.topic');
    expect(onError).toHaveBeenCalledWith(err2, 'fail.topic', 'fail.topic');
  });

  it('invokes onError and throws AggregateError on sync dispatch failures', () => {
    const onError = vi.fn();
    const dispatcher = new NotificationDispatcher({ onError });

    const err = new Error('Sync fail');
    dispatcher.subscribe('sync.fail', () => {
      throw err;
    });

    expect(() => dispatcher.dispatchSync('sync.fail', {})).toThrow(err);
    expect(onError).toHaveBeenCalledWith(err, 'sync.fail', 'sync.fail');
  });
});
