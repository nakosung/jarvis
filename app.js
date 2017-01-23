const _ = require('lodash')

let recipe = require('./data/sample.json')

function gather_vars(recipe) {
    let out = {}
    _.each(recipe,(v,k) => {
        if (k[0] != "@") {
            if (_.isArray(v)) {
                if (_.isObject(v[v.length-1])) {
                    out[k] = ['range', v.slice(0,v.length-1), v[v.length-1]]
                } else {
                    out[k] = ['range', v]
                }                
            } else if (_.isString(v) || _.isNumber(v)) {
                out[k] = ['const', v]
            } else if (_.isObject(v)) {
                let sub = gather_vars(v)
                if (_.keys(sub).length) {
                    out[k] = sub
                }                
            } 
        }
    })
    return out
}

function pack_vars(x,prefix = '') {
    let out = {}
    _.each(x,(v,k) => {
        if (_.isArray(v)) {
            out[prefix + k] = v
        } else {
            _.extend(out,pack_vars(v,`${prefix}${k}.`))
        }
    })
    return out
}

function unpack_vars(x, prefix = '') {
    let out = {}
    _.each(x,(v,k) => {
        if (k.substr(0,prefix.length) != prefix) return
        k = k.substr(prefix.length)

        let index = k.indexOf('.')
        if (index<0) {
            out[k] = v
        } else {
            let kk = k.substr(0,index)
            out[kk] = _.extend(out[kk] || {}, unpack_vars(x,prefix+kk+'.'))
        }
    })
    return out
}

function sample_vars(packed,session) {
    let out = {}
    let fn = {
        const: arg => arg,
        range: (arg,opt) => {
            if (opt && opt.cont) {
                if (opt.cont == 'log') {
                    return Math.exp(Math.random() * Math.log(arg[1] - arg[0])) + arg[0]
                } else {
                    return Math.random() * (arg[1] - arg[0]) + arg[0]
                }                
            } else {
                return _.shuffle(arg)[0]
            }
        }
    }
    _.each(packed,(v,k) => {
        let [type,arg,opt] = v
        out[k] = fn[type](arg,opt)
    })
    return out
}

function fetch_session(recipe) {
    return Promise.resolve({})
}

function sample(recipe) {
    return fetch_session(recipe)
        .then(session => unpack_vars(sample_vars(pack_vars(gather_vars(recipe)),session)))
}

function locate(data,vars) {
    if (data["@origin"] == undefined) throw new Error("Unable to locate non-data")
    return launch_with_vars(data,vars).then(([node,cont]) => {
        let docker = new Docker(node)
        return docker.exec(`wait ${cont}`).then(() => [[node,cont]])
    })
}

function scp(src_host,src_file,dest_host,dest_file) {
    return Promise.resolve()
}

function move(recipe,vars,src,dest) {
    let src_docker = new Docker(src[0])
    let dest_docker = new Docker(dest[1])
    let id = src[1]
    let dest_id = dest[1]
    return src_docker.exec(`run --rm --volumes-from ${id} -v /tmp:/backup ubuntu tar cvf /backup/${id} /dbdata-fixme`)
        .then(() => scp(src[0],`/tmp/${id}.tar`,dest[1],`/tmp/${id}.tar`))
        .then(() => dest_docker.exec(`run -v /dbdata-fix-me --name ${dest_id} ubuntu /bin/bash`))
        .then(() => dest_docker.exec(`run --volumes-from ${dest_id} -v /tmp:/backup ubuntu bash -c "cd /dbdata && tar xvf /backup/${id}.tar --strip 1"`))    
}

function calc_id(recipe,vars) {
    return Math.random().toString(16).substr(2,12)
}

function launch_with_vars(recipe,vars) {
    let pre = []
    let Ks = []
    _.each(recipe,(v,k) => {
        if (v["@origin"]) {
            pre.push(locate(v,vars[k] || {}))
            Ks.push(k)
        }
    })
    return Promise.all(pre).then(locations => {        
        let node = vars.node || (locations.length ? locations[0][0][0] : '?')
        let moves = []
        locations.forEach((v,k) => {
            k = Ks[k]
            if (!_.some(v,v => v[0] == node)) {            
                let first = v[0]    
                moves.push(move(recipe[k],vars[k],first,[node,first[1]]))
            }        
        })
        return Promise.all(moves).then(() => {
            console.log(`Launching @${node} ${JSON.stringify(recipe).substr(0,60)}`)
            let docker = new Docker(node)            
            let image = recipe["@image"]
            let volumes = locations.map(l => l[0][1])
            let id = image + '-' + calc_id(recipe,vars)
            volumes = volumes.map(v => `--volumes-from ${v}`).join(' ')
            return docker.exec(`build -t ${image}`).then(x => 
                docker.exec(`run -t ${volumes} --name ${id} ${image}`)
            ).then(x => [node,id])
        })
    })
}

function launch(recipe) {
    return sample(recipe).then(vars => launch_with_vars(recipe,vars))
}

// runner가 reporter와 함께 작동한다. (working container -> report)
// master는 runner의 상태를 모두 monitoring한다.

class Docker {
    constructor(host) {
        this.host = host
    }

    exec(args) {
        console.log(`docker -H=tcp://${this.host}:2375 ${args}`)
        return Promise.resolve()
    }
}

class Container {
    constructor(recipe,id) {
        [this.instance,this.node] = id.split('@')
        this.recipe = recipe
        this.docker = new Docker(this.node)
    }
}

class Instance extends Container {
    constructor(recipe,id) {
        super(recipe,id)
    }

    freeze() {
        return this.docker.exec(`stop ${this.instance} --time=30`)
    }

    thaw() {
        return this.docker.exec(`restart ${this.instance}`)
    }
}

function search(recipe) {
    return Promise.resolve([new Instance(recipe,'instance@node')])
}

launch(recipe)
