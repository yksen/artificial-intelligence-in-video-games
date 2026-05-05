export const task = (name, params = {}) => ({ type: 'task', name, params })
export const operator = (name, params = {}) => ({ type: 'operator', name, params })

export class HTNPlanner {
  constructor({ methods = [], operators = [], maxDepth = 64 } = {}) {
    this.methodsByTask = new Map()
    this.operators = new Map()
    this.maxDepth = maxDepth

    for (const method of methods) {
      if (!method.task || !method.name || !method.subtasks) {
        throw new Error('HTN methods require task, name, and subtasks fields.')
      }

      const existing = this.methodsByTask.get(method.task) ?? []
      existing.push(method)
      this.methodsByTask.set(method.task, existing)
    }

    for (const primitive of operators) {
      if (!primitive.name || !primitive.action) {
        throw new Error('HTN operators require name and action fields.')
      }

      this.operators.set(primitive.name, primitive)
    }
  }

  plan(root, context) {
    const trace = []
    const actions = this._expand(root, context, [], 0, trace)
    return { actions, trace }
  }

  _expand(node, context, lineage, depth, trace) {
    if (depth > this.maxDepth) {
      throw new Error(`HTN exceeded max depth while expanding ${node.name}.`)
    }

    if (node.type === 'operator') {
      return this._expandOperator(node, context, lineage)
    }

    if (node.type !== 'task') {
      throw new Error(`Unknown HTN node type: ${node.type}`)
    }

    return this._expandTask(node, context, lineage, depth, trace)
  }

  _expandTask(node, context, lineage, depth, trace) {
    const methods = this.methodsByTask.get(node.name) ?? []
    const failures = []

    for (const method of methods) {
      if (method.precondition && !method.precondition(context, node.params)) continue

      const traceStart = trace.length
      try {
        trace.push({ task: node.name, method: method.name })
        const subtasks = method.subtasks(context, node.params) ?? []
        return this._expandAll(subtasks, context, [...lineage, `${node.name}:${method.name}`], depth + 1, trace)
      } catch (err) {
        failures.push(`${method.name}: ${err.message}`)
        trace.length = traceStart
      }
    }

    const reason = failures.length ? ` Tried ${failures.join('; ')}` : ''
    throw new Error(`No HTN method for ${node.name}.${reason}`)
  }

  _expandAll(nodes, context, lineage, depth, trace) {
    const actions = []

    for (const node of nodes) {
      actions.push(...this._expand(node, context, lineage, depth, trace))
    }

    return actions
  }

  _expandOperator(node, context, lineage) {
    const primitive = this.operators.get(node.name)
    if (!primitive) throw new Error(`No HTN operator named ${node.name}.`)
    if (primitive.precondition && !primitive.precondition(context, node.params)) {
      throw new Error(`HTN operator precondition failed: ${node.name}.`)
    }

    const action = primitive.action(context, node.params)
    if (!action) return []

    return [{
      ...action,
      htn: {
        operator: node.name,
        lineage,
      },
    }]
  }
}
