//
// Tests that a balancer round loads newly sharded collection data
//

var options = {mongosOptions : {verbose : 1}};

var st = new ShardingTest({shards : 2, mongos : 2, other : options});

// Stop balancer initially
st.stopBalancer();

var staleMongos = st.s0;
var mongos = st.s1;
var coll = mongos.getCollection("foo.bar");

// Shard collection through first mongos
assert(mongos.adminCommand({enableSharding : coll.getDB() + ""}).ok);
assert(mongos.adminCommand({shardCollection : coll + "", key : {_id : 1}}).ok);

// Create a bunch of chunks
var numSplits = 20;
for ( var i = 0; i < numSplits; i++) {
    assert(mongos.adminCommand({split : coll + "", middle : {_id : i}}).ok);
}

// stop st.s1
st.stopMongos(1);

// Start balancer, which lets the stale mongos balance
st.startBalancer();

// Make sure we eventually start moving chunks
assert.soon(function() {
    return staleMongos.getCollection("config.changelog").count({what : /moveChunk/}) > 0;
}, "no balance happened", 5 * 60 * 1000);

jsTest.log("DONE!");

st.stop();
