ToolTest = function( name, extraOptions ){
    this.name = name;
    this.options = extraOptions;
    this.port = allocatePorts(1)[0];
    this.baseName = "jstests_tool_" + name;
    this.root = MongoRunner.dataPath + this.baseName;
    this.dbpath = this.root + "/";
    this.ext = this.root + "_external/";
    this.extFile = this.root + "_external/a";
    resetDbpath( this.dbpath );
    resetDbpath( this.ext );
}

ToolTest.prototype.startDB = function( coll ){
    assert( ! this.m , "db already running" );

    var options = {port : this.port,
                   dbpath : this.dbpath,
                   nohttpinterface : "",
                   noprealloc : "",
                   smallfiles : "",
                   bind_ip : "127.0.0.1"};

    Object.extend(options, this.options);

    this.m = startMongoProgram.apply(null, MongoRunner.arrOptions("mongod", options));
    this.db = this.m.getDB( this.baseName );
    if ( coll )
        return this.db.getCollection( coll );
    return this.db;
}

ToolTest.prototype.stop = function(){
    if ( ! this.m )
        return;
    _stopMongoProgram( this.port );
    this.m = null;
    this.db = null;

    print('*** ' + this.name + " completed successfully ***");
}

ToolTest.prototype.runTool = function(){
    var a = [ "mongo" + arguments[0] ];

    var hasdbpath = false;
    
    for ( var i=1; i<arguments.length; i++ ){
        a.push( arguments[i] );
        if ( arguments[i] == "--dbpath" )
            hasdbpath = true;
    }

    if ( ! hasdbpath ){
        a.push( "--host" );
        a.push( "127.0.0.1:" + this.port );
    }

    return runMongoProgram.apply( null , a );
}


ReplTest = function( name, ports ){
    this.name = name;
    this.ports = ports || allocatePorts( 2 );
}

ReplTest.prototype.getPort = function( master ){
    if ( master )
        return this.ports[ 0 ];
    return this.ports[ 1 ]
}

ReplTest.prototype.getPath = function( master ){
    var p = MongoRunner.dataPath + this.name + "-";
    if ( master )
        p += "master";
    else
        p += "slave"
    return p;
}

ReplTest.prototype.getOptions = function( master , extra , putBinaryFirst, norepl ){

    if ( ! extra )
        extra = {};

    if ( ! extra.oplogSize )
        extra.oplogSize = "40";
        
    var a = []
    if ( putBinaryFirst )
        a.push( "mongod" )
    a.push( "--nohttpinterface", "--noprealloc", "--bind_ip" , "127.0.0.1" , "--smallfiles" );

    a.push( "--port" );
    a.push( this.getPort( master ) );

    a.push( "--dbpath" );
    a.push( this.getPath( master ) );
    
    if( jsTestOptions().noJournal && !('journal' in extra)) a.push( "--nojournal" )
    if( jsTestOptions().noJournalPrealloc ) a.push( "--nopreallocj" )
    if( jsTestOptions().keyFile ) {
        a.push( "--keyFile" )
        a.push( jsTestOptions().keyFile )
    }

    if ( !norepl ) {
        if ( master ){
            a.push( "--master" );
        }
        else {
            a.push( "--slave" );
            a.push( "--source" );
            a.push( "127.0.0.1:" + this.ports[0] );
        }
    }
    
    for ( var k in extra ){
        var v = extra[k];
        if( k in MongoRunner.logicalOptions ) continue
        a.push( "--" + k );
        if ( v != null && v !== "")
            a.push( v );                    
    }

    return a;
}

ReplTest.prototype.start = function( master , options , restart, norepl ){
    var lockFile = this.getPath( master ) + "/mongod.lock";
    removeFile( lockFile );
    var o = this.getOptions( master , options , restart, norepl );

    if (restart) {
        var conn = startMongoProgram.apply(null, o);
        if (!master) {
            conn.setSlaveOk();
        }
        return conn;
    } else {
        var conn = _startMongod.apply(null, o);
        if (jsTestOptions().keyFile || jsTestOptions().auth) {
            jsTest.authenticate(conn);
        }
        if (!master) {
            conn.setSlaveOk();
        }
        return conn;
    }
}

ReplTest.prototype.stop = function( master , signal ){
    if ( arguments.length == 0 ){
        this.stop( true );
        this.stop( false );
        return;
    }

    print('*** ' + this.name + " completed successfully ***");
    return _stopMongoProgram( this.getPort( master ) , signal || 15 );
}

allocatePorts = function( n , startPort ) {
    var ret = [];
    var start = startPort || 31000;
    for( var i = start; i < start + n; ++i )
        ret.push( i );
    return ret;
}


SyncCCTest = function( testName , extraMongodOptions ){
    this._testName = testName;
    this._connections = [];
    
    for ( var i=0; i<3; i++ ){
        this._connections.push(MongoRunner.runMongod(extraMongodOptions));
    }
    
    this.url = this._connections.map( function(z){ return z.name; } ).join( "," );
    this.conn = new Mongo( this.url );
}

SyncCCTest.prototype.stop = function(){
    for ( var i=0; i<this._connections.length; i++){
        _stopMongoProgram( 30000 + i );
    }

    print('*** ' + this._testName + " completed successfully ***");
}

SyncCCTest.prototype.checkHashes = function( dbname , msg ){
    var hashes = this._connections.map(
        function(z){
            return z.getDB( dbname ).runCommand( "dbhash" );
        }
    );

    for ( var i=1; i<hashes.length; i++ ){
        assert.eq( hashes[0].md5 , hashes[i].md5 , "checkHash on " + dbname + " " + msg + "\n" + tojson( hashes ) )
    }
}

SyncCCTest.prototype.tempKill = function( num ){
    num = num || 0;
    MongoRunner.stopMongod(this._connections[num]);
}

SyncCCTest.prototype.tempStart = function( num ){
    num = num || 0;
    var old = this._connections[num];
    this._connections[num] = MongoRunner.runMongod({
            restart: true, cleanData: false, port: old.port, dbpath: old.dbpath});
}


function startParallelShell( jsCode, port, noConnect ){
    var x;

    var args = ["mongo"];

    if (typeof db == "object") {
        var hostAndPort = db.getMongo().host.split(':');
        var host = hostAndPort[0];
        args.push("--host", host);
        if (!port && hostAndPort.length >= 2) {
            var port = hostAndPort[1];
        }
    }
    if (port) {
        args.push("--port", port);
    }

    // Convert function into call-string
    if (typeof(jsCode) == "function") {
        var id = Math.floor(Math.random() * 100000);
        jsCode = "var f" + id + " = " + jsCode.toString() + ";f" + id + "();"; 
    }
    else if(typeof(jsCode) == "string") {}
        // do nothing
    else {
        throw Error("bad first argument to startParallelShell");
    }
    
    if (noConnect) {
        args.push("--nodb");
    } else if (typeof(db) == "object") {
        jsCode = "db = db.getSiblingDB('" + db.getName() + "');" + jsCode;
    }

    if (TestData) {
        jsCode = "TestData = " + tojson(TestData) + ";" + jsCode;
    }

    args.push("--eval", jsCode);

    x = startMongoProgramNoConnect.apply(null, args);
    return function(){
        return waitProgram( x );
    };
}

var testingReplication = false;
