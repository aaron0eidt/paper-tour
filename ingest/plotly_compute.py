#!/usr/bin/env python3
"""Bounded mathematical AST -> Plotly figure JSON. No model-authored Python is executed.

The author controls mathematical expressions and figure data; this fixed evaluator has no
imports, attributes, callbacks, file access or arbitrary Python syntax in its input language.
"""
import json
import math
import sys


def finite(x):
    return float(x) if isinstance(x, (int, float)) and math.isfinite(x) and abs(x) < 1e100 else None


def compute(tree, x, a, depth=0):
    if depth > 20 or not isinstance(tree, dict):
        raise ValueError('Invalid mathematical AST')
    if 'value' in tree:
        return finite(tree['value'])
    if 'variable' in tree:
        return x if tree['variable'] == 'x' else a
    args = [compute(arg, x, a, depth + 1) for arg in tree.get('args', [])]
    if not args or len(args) > 4 or any(v is None for v in args):
        return None
    op = tree.get('op')
    try:
        if op == '+': value = args[0] + args[1]
        elif op == '-': value = args[0] - args[1]
        elif op == '*': value = args[0] * args[1]
        elif op == '/': value = args[0] / args[1]
        elif op == '^': value = math.pow(args[0], args[1])
        elif op == 'neg': value = -args[0]
        elif op == 'pos': value = args[0]
        elif op == 'min': value = min(args)
        elif op == 'max': value = max(args)
        elif op == 'relu': value = max(0, args[0])
        elif op == 'sigmoid': value = 1 / (1 + math.exp(-args[0])) if args[0] >= 0 else math.exp(args[0]) / (1 + math.exp(args[0]))
        elif op == 'softmax':
            peak = max(args)
            value = math.exp(args[0] - peak) / sum(math.exp(v - peak) for v in args)
        elif op in ('sin', 'cos', 'tanh', 'exp', 'log', 'sqrt', 'abs'):
            value = abs(args[0]) if op == 'abs' else getattr(math, op)(args[0])
        else: raise ValueError('Unsupported mathematical operation')
        return finite(value)
    except (ValueError, OverflowError, ZeroDivisionError, TypeError):
        return None


def main():
    raw = sys.stdin.read(300001)
    if len(raw) > 300000: raise ValueError('Figure input too large')
    request = json.loads(raw)
    figure = request['figure']
    tasks = request['functions']
    if len(tasks) > 6 or len(figure['data']) > 12: raise ValueError('Too many traces')
    for task in tasks:
        count = task['samples']
        if not 20 <= count <= 400: raise ValueError('Invalid sample count')
        low, high = map(float, task['domain'])
        xs = [low + (high - low) * i / (count - 1) for i in range(count)]
        ys = [compute(task['tree'], x, float(request['parameter'])) for x in xs]
        figure['data'][task['trace']].update(x=xs, y=ys)
    print(json.dumps(figure, allow_nan=False))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
