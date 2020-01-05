import { ZipArchive } from "../../dist/zip_default.js";

const { createElement, Fragment, Component } = React;

function files_from_data_transfer (data_transfer) {
    const files = [];
    if (data_transfer.items) {
        for (const item of data_transfer.items) {
            if (item.kind === 'file') {
                files.push(item.getAsFile());
            }
        }
    } else {
        for (const file of data_transfer.files) {
            files.push(file);
        }
    }
    return files;
}

class RootComponent extends Component {
    constructor (props) {
        super(props);
        this.state = { archive: null };
        this.on_archive_change = archive => this.setState({ archive });
    }

    render () {
        if (this.state.archive) {
            return createElement(ViewerComponent, { archive: this.state.archive });
        }
        else {
            return createElement(DropZoneComponent, { on_archive_change: this.on_archive_change });
        }
    }
}

function DropZoneExplainerComponent () {
    return createElement(Fragment, {}, "Drop a zip file here to begin");
}

function DropZoneComponent ({ on_archive_change }) {
    function read_file (file) {
        // TODO show busy when reading blob
        ZipArchive.from_blob(file).then(
            archive => {
                on_archive_change(archive);
            },
            error => {
                // TODO show error when invalid file
            }
        )
    }

    return createElement(
        "div",
        { 
            className: "",
            onDrop: e => {
                e.preventDefault();
                const files = files_from_data_transfer(e.dataTransfer);

                if (files.length > 1) {
                    // TODO show warning when more than 1 file is dropped
                    console.warn("too many files");
                    return;
                }

                read_file(files[0]);
            },
            onDrag: e => {
                e.preventDefault();
                // TODO show preview
            }
        },
        createElement(DropZoneExplainerComponent),
        createElement(
            "input",
            {
                type: "file",
                onChange: e => read_file(e.files[0])
            }
        )
    );
}

function ViewerComponent (props) {
    
}

ReactDOM.render(createElement(RootComponent), document.body);